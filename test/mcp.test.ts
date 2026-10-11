import { describe, expect, it } from 'vitest';
import { handleMcpRequest, ToolError, type McpServerDef } from '../site/functions/_lib/mcp.js';
import { TOOLS, createServer, describeError, type PapertradeCtx } from '../site/functions/_lib/papertrade-mcp.js';
import { buildAgentCard, buildApiCatalog, buildServerCard, wellKnownBody } from '../site/functions/_lib/agent-docs.js';
import { resolveConfig, type Env } from '../src/config.js';
import { createLimiter } from '../src/rate-limit.js';

const SOL = '3WcepPag9Q9xsAAWsGBhBPdEmMeM3qnaR8u9FGNmTgXk';
const ADDR = '0x3f139ef9f371fbbfc299aa65b93534e177141b18';
const ORIGIN = 'https://x402.test';

const ctxFor = (env: Env = {}): PapertradeCtx => ({ config: resolveConfig(env), origin: ORIGIN });
const server = createServer(() => ({ name: 'papertrade-x402' }));

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const rpc = async (body: unknown, env: Env = {}, headers: Record<string, string> = {}) => {
  const res = await handleMcpRequest(post(body, headers), server, ctxFor(env));
  return { res, json: res.status === 202 ? null : ((await res.json()) as any) };
};
const call = async (name: string, args: unknown, env: Env = {}) => (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, env)).json.result;

describe('MCP protocol plumbing', () => {
  it('initialize echoes a supported protocol version and falls back otherwise', async () => {
    for (const v of ['2025-06-18', '2025-03-26', '2024-11-05']) {
      const { json } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 't', version: '1' } } });
      expect(json.result.protocolVersion).toBe(v);
    }
    const { json } = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(json.result.protocolVersion).toBe('2025-06-18');
    expect(json.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(json.result.serverInfo).toMatchObject({ name: 'papertrade-x402', title: expect.any(String), version: expect.any(String) });
    expect(json.result.instructions).toContain('never pay');
  });

  it('answers notifications with 202 and no body, and pings', async () => {
    const note = await handleMcpRequest(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), server, ctxFor());
    expect(note.status).toBe(202);
    expect(await note.text()).toBe('');
    const { json } = await rpc({ jsonrpc: '2.0', id: 'p', method: 'ping' });
    expect(json).toEqual({ jsonrpc: '2.0', id: 'p', result: {} });
  });

  it('handles batches and returns 202 for an all-notification batch', async () => {
    const { json } = await rpc([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    expect(json).toHaveLength(2);
    expect(json.map((r: any) => r.id)).toEqual([1, 2]);
    const only = await handleMcpRequest(post([{ jsonrpc: '2.0', method: 'notifications/initialized' }]), server, ctxFor());
    expect(only.status).toBe(202);
  });

  it('uses the proper JSON-RPC error codes', async () => {
    const parse = await rpc('{nope');
    expect(parse.res.status).toBe(400);
    expect(parse.json.error.code).toBe(-32700);
    expect((await rpc({ hello: 'world' })).json.error.code).toBe(-32600);
    expect((await rpc([])).json.error.code).toBe(-32600);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'nope/nope' })).json.error.code).toBe(-32601);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'does_not_exist' } })).json.error.code).toBe(-32602);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} })).json.error.code).toBe(-32602);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_markets', arguments: [] } })).json.error.code).toBe(-32602);
  });

  it('returns empty resources and prompts lists', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).json.result).toEqual({ resources: [] });
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'prompts/list' })).json.result).toEqual({ prompts: [] });
  });

  it('frames one SSE message event when only text/event-stream is accepted', async () => {
    const res = await handleMcpRequest(post({ jsonrpc: '2.0', id: 7, method: 'ping' }, { accept: 'text/event-stream' }), server, ctxFor());
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text.startsWith('event: message\ndata: ')).toBe(true);
    expect(JSON.parse(text.split('data: ')[1])).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('GET: 405 for event streams, JSON info otherwise; DELETE: 405; OPTIONS: CORS preflight', async () => {
    const sse = await handleMcpRequest(new Request(`${ORIGIN}/mcp`, { headers: { accept: 'text/event-stream' } }), server, ctxFor());
    expect(sse.status).toBe(405);
    expect(sse.headers.get('allow')).toBe('POST');
    const info = await handleMcpRequest(new Request(`${ORIGIN}/mcp`), server, ctxFor());
    expect(info.status).toBe(200);
    expect(((await info.json()) as any).name).toBe('papertrade-x402');
    expect((await handleMcpRequest(new Request(`${ORIGIN}/mcp`, { method: 'DELETE' }), server, ctxFor())).status).toBe(405);
    const pre = await handleMcpRequest(new Request(`${ORIGIN}/mcp`, { method: 'OPTIONS' }), server, ctxFor());
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    expect(pre.headers.get('access-control-allow-headers')).toContain('Mcp-Session-Id');
    expect(pre.headers.get('access-control-allow-headers')).toContain('Mcp-Protocol-Version');
    expect(pre.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('rejects an unsupported Mcp-Protocol-Version header and oversized bodies', async () => {
    const bad = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, { 'mcp-protocol-version': '1999-01-01' });
    expect(bad.res.status).toBe(400);
    const big = await handleMcpRequest(post(`{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"${'a'.repeat(70_000)}"}}`), server, ctxFor());
    expect(big.status).toBe(413);
  });

  it('turns tool failures into isError results and never leaks unexpected errors', async () => {
    const def: McpServerDef<null> = {
      name: 't',
      title: 'T',
      version: '1',
      instructions: 'i',
      info: () => ({}),
      describeError: () => null,
      tools: [
        { name: 'known', title: 'k', description: 'd', inputSchema: {}, outputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, handler: async () => { throw new ToolError('bad input, fix it'); } },
        { name: 'boom', title: 'b', description: 'd', inputSchema: {}, outputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, handler: async () => { throw new Error('secret stack detail'); } },
      ],
    };
    const run = async (name: string) => (await (await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } }), def, null)).json()) as any;
    expect((await run('known')).result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'bad input, fix it' }] });
    const boom = (await run('boom')).result;
    expect(boom.isError).toBe(true);
    expect(boom.content[0].text).not.toContain('secret');
  });

  it('applies the rate limit hook as 429 for requests and isError for tool calls', async () => {
    const lim = createLimiter(1, 60_000);
    const def: McpServerDef<null> = { name: 't', title: 'T', version: '1', instructions: 'i', info: () => ({}), tools: [], limit: (_r, c) => lim.take('k', c.cost) };
    const first = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), def, null);
    expect(first.status).toBe(200);
    const second = await handleMcpRequest(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), def, null);
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
  });
});

describe('Papertrade tool catalog', () => {
  it('lists 10 tools with complete metadata', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = json.result.tools as any[];
    expect(tools.map((t) => t.name)).toEqual(['get_markets', 'get_service_status', 'preview_wallet_risk', 'preview_liquidations_nearby', 'preview_estimate_position', 'preview_top_traders', 'wallet_risk', 'liquidations_nearby', 'estimate_position', 'top_traders']);
    for (const t of tools) {
      expect(t.title).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe('object');
      expect(t.outputSchema.type).toBe('object');
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
      expect(typeof t.annotations.openWorldHint).toBe('boolean');
    }
    expect(TOOLS.every((t) => !/sign|send funds|place order/i.test(t.name))).toBe(true);
  });

  it('paid tools return unpaid x402 requirements for a configured deployment, Solana first', async () => {
    const r = await call('wallet_risk', { address: ADDR }, { X402_SOLANA_PAY_TO: SOL, X402_BASE_PAY_TO: '0x07977F60757bad9992aFB99A57d83449B69cBC02' });
    expect(r.isError).toBeUndefined();
    const s = r.structuredContent;
    expect(s.status).toBe('ready');
    expect(s.x402Version).toBe(2);
    expect(s.accepts.map((a: any) => a.network)).toEqual(['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'eip155:8453']);
    expect(s.accepts[0]).toMatchObject({ payTo: SOL, amount: '20000', asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });
    expect(s.request).toEqual({ method: 'GET', url: `${ORIGIN}/api/v1/wallet/${ADDR}/risk` });
    expect(s.note).toContain('never signs');
    expect(JSON.parse(r.content[0].text)).toEqual(s);
  });

  it('paid tools say plainly that payments are not configured, without inventing a payTo', async () => {
    const r = await call('estimate_position', { market: 'btc', side: 'long', marginUsd: 100, leverage: 100, exitMovePct: -0.5 });
    const s = r.structuredContent;
    expect(s.status).toBe('payments_not_configured');
    expect(s.accepts).toEqual([]);
    expect(s.note).toContain('no payment address');
    expect(s.request.method).toBe('POST');
    expect(s.request.body.leverage).toBe(100);
    expect(s.price).toEqual({ amount: '0.005', atomic: '5000', currency: 'USDC' });
  });

  it('validates input before returning requirements', async () => {
    const bad = await call('wallet_risk', { address: '0x123' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('Invalid input');
    expect((await call('top_traders', { window: '1y' })).isError).toBe(true);
    expect((await call('liquidations_nearby', { market: 'BTC', pct: 99 })).isError).toBe(true);
    expect((await call('estimate_position', { market: 'BTC', side: 'long', marginUsd: 100, leverage: 5000 })).isError).toBe(true);
    expect((await call('top_traders', { window: '7d', bogus: 1 })).isError).toBe(true);
    expect((await call('preview_wallet_risk', {})).isError).toBe(true);
  });

  it('describes input and upstream errors for the model', () => {
    expect(describeError(new Error('x'))).toBeNull();
  });

  it('serves real live data from the free tools (talks to the Papertrade API)', async () => {
    const markets = await call('get_markets', {});
    expect(markets.isError).toBeUndefined();
    expect(markets.structuredContent.markets.length).toBeGreaterThan(0);
    expect(markets.structuredContent.markets[0].markPrice).toBeGreaterThan(0);
    const status = await call('get_service_status', {});
    expect(status.structuredContent.upstream.ok).toBe(true);
    const est = await call('preview_estimate_position', { market: 'BTC', side: 'long', marginUsd: 100, leverage: 100 });
    expect(est.structuredContent.bustPrice).toBeLessThan(est.structuredContent.entryPrice);
    expect(est.structuredContent.close).toBeUndefined();
    expect(est.structuredContent.preview.tier).toBe('free-preview');
  }, 45_000);
});

describe('agent discovery documents', () => {
  it('server card lists every tool and the streamable-http endpoint', () => {
    const card = buildServerCard(ORIGIN);
    expect(card.transport).toEqual({ type: 'streamable-http', endpoint: `${ORIGIN}/mcp` });
    expect(card.tools).toHaveLength(TOOLS.length);
    expect(card.serverInfo.name).toBe('papertrade-x402');
  });

  it('agent card maps one skill per tool', () => {
    const card = buildAgentCard(ORIGIN);
    expect(card.skills.map((s) => s.id)).toEqual(TOOLS.map((t) => t.name));
    expect(card.url).toBe(ORIGIN);
    expect(card.defaultInputModes.length).toBeGreaterThan(0);
  });

  it('api catalog is an RFC 9727 linkset', () => {
    const cat = buildApiCatalog(ORIGIN);
    expect(cat.linkset[0]['service-desc'][0].href).toBe(`${ORIGIN}/openapi.json`);
    expect(cat.linkset.some((l) => l.anchor === `${ORIGIN}/mcp`)).toBe(true);
    expect(wellKnownBody('/.well-known/mcp.json', ORIGIN)).toEqual(buildServerCard(ORIGIN));
    expect(wellKnownBody('/.well-known/agent.json', ORIGIN)).toEqual(buildAgentCard(ORIGIN));
    expect(wellKnownBody('/nope', ORIGIN)).toBeNull();
  });
});

describe('rate limiter', () => {
  it('counts cost, resets after the window and evicts when full', () => {
    let t = 0;
    const lim = createLimiter(10, 1000, () => t, 2);
    expect(lim.take('a', 6).ok).toBe(true);
    expect(lim.take('a', 6).ok).toBe(false);
    expect(lim.take('a', 4).remaining).toBe(0);
    t = 1500;
    expect(lim.take('a', 6).ok).toBe(true);
    lim.take('b');
    lim.take('c');
    expect(lim.take('d').ok).toBe(true);
  });
});

describe('preview routes and explanatory 503', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const get = (p: string, env: Env = {}) => app.fetch(new Request(`${ORIGIN}${p}`), env);

  it('503 body explains the state and links the free tier', async () => {
    const res = await get(`/api/v1/wallet/${ADDR}/risk`);
    expect(res.status).toBe(503);
    const b = (await res.json()) as any;
    expect(b.error).toBe('not_configured');
    expect(b.operator.secret ?? JSON.stringify(b.operator)).toContain('X402_SOLANA_PAY_TO');
    expect(JSON.stringify(b.free)).toContain('/mcp');
    expect(JSON.stringify(b)).not.toMatch(/payTo":"[1-9A-Za-z]{32,}/);
  });

  it('invalid preview input is a free 400 and rate headers are present', async () => {
    const res = await get('/api/v1/preview/wallet/0x123/risk');
    expect(res.status).toBe(400);
    expect(res.headers.get('x-ratelimit-limit')).toBe('60');
  });
});
