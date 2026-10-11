import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { isAddress, type Address } from 'viem';
import type { AccountTrade, LeaderboardAccount, WalletState } from 'papertrade-sdk';
import { activeNetworks, resolveConfig, VERSION, type Env, type ResolvedConfig } from './config.js';
import { InputError, UpstreamError } from './errors.js';
import { loadMark, loadMarks, loadProtocolSummary, loadTradingState, loadWallet, makeClient, wad, wrapUpstream } from './data.js';
import { computeWalletRisk } from './risk.js';
import { computeEstimate, findInstrument, parseEstimateInput, type EstimateInput } from './estimate.js';
import { computeLiquidationMap, mapRangeFor, parseLiquidationQuery, type LiquidationQuery } from './liquidations.js';
import { computeTopTraders, parseTradersQuery, type TradersQuery } from './traders.js';
import { buildDiscovery } from './discovery.js';
import { buildOpenApi } from './openapi.js';
import { paymentMiddlewareFor } from './x402.js';
import { PAID_ENDPOINTS } from './endpoints.js';

type Vars = { config: ResolvedConfig; input: unknown };
type App = { Bindings: Env; Variables: Vars };
type Ctx = Context<App>;

/** The Papertrade wallet stream throttles bursts, so keep concurrency low and bound the whole scan. */
const CONCURRENCY = 3;
const SCAN_BUDGET_MS = 20_000;

/** Run `fn` over `items` with a small concurrency cap, keeping Worker subrequests bounded. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, deadlineMs = Number.POSITIVE_INFINITY): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && Date.now() < deadlineMs) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function parseAddress(raw: string): Address {
  if (!isAddress(raw, { strict: false })) throw new InputError('address must be a 0x-prefixed 40 hex character HyperEVM address', 'address');
  return raw.toLowerCase() as Address;
}

async function readJson(c: Ctx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new InputError('Body must be valid JSON');
  }
}

/** Validate the request before any payment is requested, so a malformed call is a free 400 and never a 402. */
async function validate(c: Ctx): Promise<unknown> {
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (c.req.method === 'POST' && path === '/api/v1/estimate') return parseEstimateInput(await readJson(c));
  if (c.req.method === 'GET' && path === '/api/v1/liquidations/nearby') return parseLiquidationQuery(url.searchParams);
  if (c.req.method === 'GET' && path === '/api/v1/traders/top') return parseTradersQuery(url.searchParams);
  const m = /^\/api\/v1\/wallet\/([^/]+)\/risk$/.exec(path);
  if (c.req.method === 'GET' && m) return parseAddress(decodeURIComponent(m[1]));
  return undefined;
}

const isPaidRoute = (method: string, path: string) =>
  PAID_ENDPOINTS.some((e) => {
    if (e.method !== method) return false;
    const re = new RegExp(`^${e.path.replace('{address}', '[^/]+')}$`);
    return re.test(path.replace(/\/+$/, ''));
  });

export function createApp(): Hono<App> {
  const app = new Hono<App>();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'PAYMENT-SIGNATURE', 'X-PAYMENT'],
      exposeHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'X-PAYMENT-RESPONSE'],
      maxAge: 86_400,
    }),
  );

  app.use('*', async (c, next) => {
    c.set('config', resolveConfig(c.env ?? {}));
    await next();
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  app.onError((err, c) => {
    if (err instanceof InputError) return c.json({ error: 'invalid_input', message: err.message, ...(err.field ? { field: err.field } : {}) }, 400);
    if (err instanceof UpstreamError) return c.json({ error: 'upstream_unavailable', message: err.message }, 502);
    return c.json({ error: 'internal_error', message: 'Unexpected error. You were not charged.' }, 500);
  });

  app.get('/api/v1/health', async (c) => {
    const config = c.get('config');
    const active = activeNetworks(config);
    let upstream: { ok: boolean; indexedThroughBlock?: number; tradingPaused?: boolean; error?: string };
    try {
      const t = await loadTradingState(makeClient(config.apiUrl));
      upstream = { ok: true, indexedThroughBlock: t.indexedThroughBlock, tradingPaused: t.tradingPaused };
    } catch (e) {
      upstream = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const ok = upstream.ok && config.problems.length === 0;
    return c.json(
      {
        ok,
        service: 'papertrade-x402',
        version: VERSION,
        upstream,
        x402: {
          configured: active.length > 0 && config.problems.length === 0,
          facilitator: config.facilitatorUrl,
          networks: config.networks.map((n) => ({ network: n.network, label: n.label, configured: n.configured })),
          problems: config.problems,
        },
        prices: config.prices,
      },
      ok ? 200 : 503,
    );
  });

  app.get('/api/v1/markets', async (c) => {
    const client = makeClient(c.get('config').apiUrl);
    const trading = await loadTradingState(client);
    const marks = await loadMarks(client, trading.instruments.filter((i) => i.active && !i.retired));
    const nowMs = Date.now();
    return c.json({
      asOf: new Date(nowMs).toISOString(),
      tradingPaused: trading.tradingPaused,
      markets: trading.instruments
        .filter((i) => marks.has(i.id))
        .map((i) => {
          const m = marks.get(i.id)!;
          return {
            id: i.id,
            symbol: i.symbol,
            markPrice: m.price,
            markAsOf: new Date(m.atMs).toISOString(),
            maxLeverage: i.maxLeverage,
            openable: i.openable,
            closeOnly: i.closeOnly,
            paused: i.paused,
            // OI and caps are base-asset quantities on chain; priced at the mark here.
            longOpenInterestUsd: Number((wad(i.longOiRaw) * m.price).toFixed(2)),
            shortOpenInterestUsd: Number((wad(i.shortOiRaw) * m.price).toFixed(2)),
            longCapUsd: Number((wad(i.longCapRaw) * m.price).toFixed(2)),
            shortCapUsd: Number((wad(i.shortCapRaw) * m.price).toFixed(2)),
          };
        }),
    });
  });

  app.get('/openapi.json', (c) => c.json(buildOpenApi(c.get('config'), new URL(c.req.url).origin)));
  app.get('/.well-known/x402', (c) => c.json(buildDiscovery(c.get('config'), new URL(c.req.url).origin)));

  /* Paid routes: validate (free 400), require configuration (503), then x402 (402 -> verify -> handler -> settle). */
  app.use('/api/v1/*', async (c, next) => {
    if (c.req.method === 'OPTIONS' || !isPaidRoute(c.req.method, new URL(c.req.url).pathname)) return next();
    c.set('input', await validate(c));
    const config = c.get('config');
    if (config.problems.length > 0 || activeNetworks(config).length === 0) {
      return c.json({ error: 'not_configured', message: 'Payments are not configured on this deployment.', problems: config.problems }, 503);
    }
    return paymentMiddlewareFor(config)(c, next);
  });

  app.get('/api/v1/wallet/:address/risk', async (c) => {
    const address = c.get('input') as Address;
    const client = makeClient(c.get('config').apiUrl);
    const [state, trading] = await Promise.all([loadWallet(address, c.get('config').apiUrl), loadTradingState(client)]);
    const marks = await loadMarks(client, trading.instruments.filter((i) => state.positions.some((p) => p.instrumentId === i.id)));
    return c.json(computeWalletRisk({ state, instruments: trading.instruments, marks, nowMs: Date.now() }));
  });

  app.get('/api/v1/liquidations/nearby', async (c) => {
    const query = c.get('input') as LiquidationQuery;
    const config = c.get('config');
    const client = makeClient(config.apiUrl);
    const trading = await loadTradingState(client);
    const instrument = findInstrument(trading, query.market);
    const [mark, board, protocol] = await Promise.all([
      loadMark(client, instrument),
      wrapUpstream('Papertrade leaderboard', () => client.leaderboard({ window: '24h', sortKey: 'currentOpenNotional', sortDir: 'desc', pageSize: query.accounts })),
      wrapUpstream('Papertrade liquidation map', () => client.liquidationMap(instrument.id, mapRangeFor(query.pct))),
    ]);
    const holders = board.accounts.filter((a) => a.currentOpenPositionCount > 0);
    const results = await mapLimit(
      holders,
      CONCURRENCY,
      (a: LeaderboardAccount) => loadWallet(a.address, config.apiUrl, { timeoutMs: 6_000, retries: 0 }).catch(() => null),
      Date.now() + SCAN_BUDGET_MS,
    );
    const wallets = results.filter((w): w is WalletState => w !== undefined && w !== null);
    if (holders.length > 0 && wallets.length === 0) throw new UpstreamError('Could not read any wallet snapshots from Papertrade');
    return c.json(computeLiquidationMap({ query, instrument, mark, wallets, protocol, accountsRequested: holders.length, nowMs: Date.now() }));
  });

  app.post('/api/v1/estimate', async (c) => {
    const input = c.get('input') as EstimateInput;
    const client = makeClient(c.get('config').apiUrl);
    const trading = await loadTradingState(client);
    const instrument = findInstrument(trading, input.market);
    const [mark, summary] = await Promise.all([loadMark(client, instrument), loadProtocolSummary(client)]);
    return c.json(computeEstimate({ input, trading, mark, instrument, summary, nowMs: Date.now() }));
  });

  app.get('/api/v1/traders/top', async (c) => {
    const query = c.get('input') as TradersQuery;
    const client = makeClient(c.get('config').apiUrl);
    const board = await wrapUpstream('Papertrade leaderboard', () =>
      client.leaderboard({ window: query.window, sortKey: 'totalWindowedPnl', sortDir: 'desc', pageSize: query.limit }),
    );
    const accounts = board.accounts.slice(0, query.limit);
    const pages = await mapLimit(accounts, CONCURRENCY, (a) =>
      client.accountTrades(a.address).then((p) => p.items as AccountTrade[]).catch(() => null),
    );
    const trades = new Map<string, AccountTrade[] | null>(accounts.map((a, i) => [a.address, pages[i] ?? null]));
    return c.json(computeTopTraders({ query, accounts, trades, totalAccounts: board.summary.uniqueAccounts, nowMs: Date.now() }));
  });

  app.notFound((c) => c.json({ error: 'not_found', message: 'Unknown route. See /openapi.json or /.well-known/x402.' }, 404));
  return app;
}
