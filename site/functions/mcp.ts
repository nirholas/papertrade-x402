import type { Env } from '../../src/config.js';
import { handleMcpRequest } from './_lib/mcp.js';
import { TOOLS, contextFor, createServer } from './_lib/papertrade-mcp.js';

export const onRequest: PagesFunction<Env> = (context) => {
  const ctx = contextFor(context.request, context.env);
  const server = createServer(() => ({
    name: 'papertrade-x402',
    transport: 'streamable-http',
    endpoint: `${ctx.origin}/mcp`,
    method: 'POST',
    tools: TOOLS.map((t) => t.name),
    docs: `${ctx.origin}/docs/mcp/`,
    serverCard: `${ctx.origin}/.well-known/mcp/server-card.json`,
    message: 'POST JSON-RPC 2.0 messages to this URL. Free tools return live data; paid tools return x402 payment requirements and never pay.',
  }));
  return handleMcpRequest(context.request, server, ctx);
};
