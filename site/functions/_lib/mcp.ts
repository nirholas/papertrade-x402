/**
 * Minimal stateless MCP server over Streamable HTTP (JSON-RPC 2.0).
 *
 * No sessions, no cookies, no server-initiated messages: every POST is answered on its own, so it
 * runs unchanged in a Cloudflare Pages Function. Tools are plain objects; `handleMcpRequest` owns the
 * protocol (negotiation, batching, SSE framing, CORS, error codes) and nothing else.
 */

export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const DEFAULT_PROTOCOL = SUPPORTED_PROTOCOLS[0];
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 20;

type Json = Record<string, unknown>;

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** What a tool handler returns: the structured result plus an optional human summary line. */
export interface ToolResult {
  data: Json;
  text?: string;
}

/** Thrown by a handler for a failure the model can act on. Becomes a tool result with isError. */
export class ToolError extends Error {}

export interface McpTool<Ctx> {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  outputSchema: Json;
  annotations: ToolAnnotations;
  /** Relative upstream cost for rate limiting. Defaults to 1. */
  cost?: number;
  handler(args: Json, ctx: Ctx): Promise<ToolResult>;
}

export interface McpServerDef<Ctx> {
  name: string;
  title: string;
  version: string;
  instructions: string;
  tools: McpTool<Ctx>[];
  /** Maps a thrown error to a message safe to show the model, or null to treat it as an unexpected failure. */
  describeError?(err: unknown): string | null;
  /** Rate limit hook. Return a failing result to refuse the call. */
  limit?(req: Request, call: { method: string; tool?: string; cost: number }): { ok: boolean; retryAfter: number } | null;
  /** Shown by a plain GET. */
  info(): Json;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version, Retry-After',
  'Access-Control-Max-Age': '86400',
};

export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });

function respond(body: unknown, init: { status?: number; sse?: boolean; headers?: Record<string, string> } = {}): Response {
  const headers = { ...CORS_HEADERS, 'Cache-Control': 'no-store', ...init.headers };
  if (init.sse) {
    return new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { status: init.status ?? 200, headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8' } });
  }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

const empty = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers: { ...CORS_HEADERS, ...headers } });

/** SSE only when the client accepts event-stream and does not accept plain JSON. */
function wantsSse(req: Request): boolean {
  const accept = (req.headers.get('Accept') ?? '').toLowerCase();
  return accept.includes('text/event-stream') && !accept.includes('application/json') && !accept.includes('*/*');
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function toolListing<Ctx>(t: McpTool<Ctx>): Json {
  return { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: { title: t.title, ...t.annotations } };
}

export const describeTools = <Ctx>(tools: McpTool<Ctx>[]): Json[] => tools.map(toolListing);

async function callTool<Ctx>(server: McpServerDef<Ctx>, params: Json, ctx: Ctx, req: Request): Promise<Json> {
  const tool = server.tools.find((t) => t.name === params.name);
  if (!tool) throw new RpcFailure(RPC.invalidParams, `Unknown tool: ${String(params.name)}`);
  const args = params.arguments ?? {};
  if (!isObject(args)) throw new RpcFailure(RPC.invalidParams, 'arguments must be an object');
  const gate = server.limit?.(req, { method: 'tools/call', tool: tool.name, cost: tool.cost ?? 1 });
  if (gate && !gate.ok) {
    return { isError: true, content: [{ type: 'text', text: `Rate limit reached. Retry in ${gate.retryAfter} seconds.` }] };
  }
  try {
    const { data, text } = await tool.handler(args, ctx);
    return { content: [{ type: 'text', text: text ?? JSON.stringify(data) }], structuredContent: data };
  } catch (err) {
    const message = err instanceof ToolError ? err.message : server.describeError?.(err);
    return { isError: true, content: [{ type: 'text', text: message ?? 'The tool failed unexpectedly. Nothing was charged.' }] };
  }
}

class RpcFailure extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/** Handle one JSON-RPC message. Returns null for notifications and for responses sent by the client. */
async function dispatch<Ctx>(server: McpServerDef<Ctx>, msg: unknown, ctx: Ctx, req: Request): Promise<Json | null> {
  if (!isObject(msg) || msg.jsonrpc !== '2.0') return rpcError(isObject(msg) ? msg.id : null, RPC.invalidRequest, 'Invalid JSON-RPC 2.0 message');
  const hasId = msg.id !== undefined && msg.id !== null;
  if (typeof msg.method !== 'string') {
    // A response or error object from the client: nothing to do.
    return 'result' in msg || 'error' in msg ? null : rpcError(msg.id, RPC.invalidRequest, 'Missing method');
  }
  if (!hasId) return null; // notification
  const id = msg.id;
  const params = isObject(msg.params) ? msg.params : {};
  try {
    switch (msg.method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = (SUPPORTED_PROTOCOLS as readonly string[]).includes(asked) ? asked : DEFAULT_PROTOCOL;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: server.name, title: server.title, version: server.version },
            instructions: server.instructions,
          },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: describeTools(server.tools) } };
      case 'tools/call': {
        if (typeof params.name !== 'string') throw new RpcFailure(RPC.invalidParams, 'params.name is required');
        return { jsonrpc: '2.0', id, result: await callTool(server, params, ctx, req) };
      }
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: [] } };
      case 'resources/templates/list':
        return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: [] } };
      default:
        return rpcError(id, RPC.methodNotFound, `Method not found: ${msg.method}`);
    }
  } catch (err) {
    if (err instanceof RpcFailure) return rpcError(id, err.code, err.message);
    return rpcError(id, RPC.internal, 'Internal error');
  }
}

export async function handleMcpRequest<Ctx>(req: Request, server: McpServerDef<Ctx>, ctx: Ctx): Promise<Response> {
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') return empty(204);

  if (method === 'GET') {
    if ((req.headers.get('Accept') ?? '').toLowerCase().includes('text/event-stream')) {
      return respond({ error: 'method_not_allowed', message: 'This server does not offer a server-to-client stream. POST JSON-RPC messages to this URL.' }, { status: 405, headers: { Allow: 'POST' } });
    }
    return respond(server.info());
  }
  if (method !== 'POST') {
    return respond({ error: 'method_not_allowed', message: 'This server is stateless: there are no sessions to delete. POST JSON-RPC messages to this URL.' }, { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } });
  }

  const sse = wantsSse(req);
  const version = req.headers.get('Mcp-Protocol-Version');
  if (version && !(SUPPORTED_PROTOCOLS as readonly string[]).includes(version)) {
    return respond(rpcError(null, RPC.invalidRequest, `Unsupported MCP-Protocol-Version: ${version}. Supported: ${SUPPORTED_PROTOCOLS.join(', ')}`), { status: 400, sse });
  }

  const gate = server.limit?.(req, { method: 'request', cost: 1 });
  if (gate && !gate.ok) {
    return respond(rpcError(null, -32000, `Rate limit reached. Retry in ${gate.retryAfter} seconds.`), { status: 429, sse, headers: { 'Retry-After': String(gate.retryAfter) } });
  }

  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) return respond(rpcError(null, RPC.invalidRequest, 'Request body too large'), { status: 413, sse });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return respond(rpcError(null, RPC.invalidRequest, 'Request body too large'), { status: 413, sse });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return respond(rpcError(null, RPC.parse, 'Parse error: body is not valid JSON'), { status: 400, sse });
  }

  const headers = { 'Mcp-Protocol-Version': version ?? DEFAULT_PROTOCOL };

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return respond(rpcError(null, RPC.invalidRequest, 'Empty batch'), { status: 400, sse });
    if (parsed.length > MAX_BATCH) return respond(rpcError(null, RPC.invalidRequest, `Batch too large (max ${MAX_BATCH})`), { status: 400, sse });
    const out = (await Promise.all(parsed.map((m) => dispatch(server, m, ctx, req)))).filter((r): r is Json => r !== null);
    return out.length === 0 ? empty(202, headers) : respond(out, { sse, headers });
  }

  const result = await dispatch(server, parsed, ctx, req);
  if (result === null) return empty(202, headers);
  const bad = 'error' in result && (result.error as Json).code === RPC.invalidRequest;
  return respond(result, { sse, headers, status: bad ? 400 : 200 });
}
