import { activeNetworks, VERSION, type ResolvedConfig } from './config.js';
import { PAID_ENDPOINTS } from './endpoints.js';
import { PREVIEW } from './preview.js';

type Json = Record<string, unknown>;

function parametersFor(path: string, schema: Json): Json[] {
  const props = (schema.properties ?? {}) as Record<string, Json>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(props).map(([name, s]) => ({
    name,
    in: path.includes(`{${name}}`) ? 'path' : 'query',
    required: path.includes(`{${name}}`) || required.has(name),
    schema: s,
    ...(typeof s.description === 'string' ? { description: s.description } : {}),
  }));
}

export function buildOpenApi(config: ResolvedConfig, origin: string) {
  const paths: Record<string, Json> = {
    '/api/v1/health': {
      get: { summary: 'Service health', tags: ['free'], responses: { '200': { description: 'Status of the API, the Papertrade upstream and x402 configuration' } } },
    },
    '/api/v1/markets': {
      get: { summary: 'Live instruments and mark prices', tags: ['free'], responses: { '200': { description: 'Instruments with mark price, limits and open interest' } } },
    },
  };
  for (const e of PAID_ENDPOINTS) {
    const pv = PREVIEW[e.id];
    const free: Json = {
      operationId: `preview_${e.id.replace(/-/g, '_')}`,
      summary: `${e.summary} (free preview)`,
      description: `Free, rate limited. Same live computation as the paid endpoint, without: ${pv.omits.join('; ')}. Responses carry X-RateLimit-Limit and X-RateLimit-Remaining; 429 includes Retry-After.`,
      tags: ['free', 'preview'],
      responses: { '200': { description: 'Preview result' }, '400': { description: 'Invalid input' }, '429': { description: 'Rate limited' }, '502': { description: 'Papertrade upstream unavailable' } },
    };
    if (e.method === 'POST') free.requestBody = { required: true, content: { 'application/json': { schema: e.inputSchema, example: e.inputExample } } };
    else free.parameters = parametersFor(pv.path, e.inputSchema);
    paths[pv.path] = { [e.method.toLowerCase()]: free };
    const op: Json = {
      operationId: e.id.replace(/-/g, '_'),
      summary: e.summary,
      description: e.description,
      tags: ['paid'],
      'x-payment-info': {
        price: { mode: 'fixed', currency: 'USD', amount: config.prices[e.id] },
        protocols: [{ x402: {} }],
      },
      responses: {
        '200': { description: 'Result', content: { 'application/json': { schema: e.outputSchema } } },
        '400': { description: 'Invalid input (not charged)' },
        '402': { description: 'Payment required. The PAYMENT-REQUIRED header carries the base64 x402 v2 requirements.' },
        '502': { description: 'Papertrade upstream unavailable (not charged)' },
        '503': { description: 'Payment addresses are not configured on this deployment' },
      },
    };
    if (e.method === 'POST') op.requestBody = { required: true, content: { 'application/json': { schema: e.inputSchema, example: e.inputExample } } };
    else op.parameters = parametersFor(e.path, e.inputSchema);
    paths[e.path] = { [e.method.toLowerCase()]: op };
  }
  paths['/mcp'] = {
    post: {
      operationId: 'mcp',
      summary: 'MCP server (Streamable HTTP, stateless JSON-RPC 2.0)',
      description: 'Model Context Protocol endpoint. Methods: initialize, ping, tools/list, tools/call. Free tools return live data; paid tools return x402 payment requirements and never pay. See /docs/mcp/.',
      tags: ['free', 'mcp'],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['jsonrpc', 'method'], properties: { jsonrpc: { const: '2.0' }, id: { type: ['string', 'number'] }, method: { type: 'string' }, params: { type: 'object' } } }, example: { jsonrpc: '2.0', id: 1, method: 'tools/list' } } } },
      responses: { '200': { description: 'JSON-RPC response (application/json, or one SSE message event when only text/event-stream is accepted)' }, '202': { description: 'Notification accepted' }, '400': { description: 'Parse error or invalid request' }, '429': { description: 'Rate limited' } },
    },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'papertrade-x402',
      version: VERSION,
      description: `Unofficial pay-per-call Papertrade intelligence API (x402). Networks: ${activeNetworks(config).map((n) => n.network).join(', ') || 'none configured'}. Not affiliated with Papertrade.`,
      license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    },
    servers: [{ url: origin }],
    paths,
  };
}
