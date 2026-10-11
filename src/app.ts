import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { Address } from 'viem';
import { activeNetworks, resolveConfig, VERSION, type Env, type ResolvedConfig } from './config.js';
import { InputError, UpstreamError } from './errors.js';
import { loadTradingState, makeClient } from './data.js';
import { parseEstimateInput, type EstimateInput } from './estimate.js';
import { parseLiquidationQuery, type LiquidationQuery } from './liquidations.js';
import { parseTradersQuery, type TradersQuery } from './traders.js';
import { parseAddress, runEstimate, runHealth, runLiquidationsNearby, runMarkets, runTopTraders, runWalletRisk } from './handlers.js';
import { buildDiscovery } from './discovery.js';
import { buildOpenApi } from './openapi.js';
import { paymentMiddlewareFor } from './x402.js';
import { PAID_ENDPOINTS } from './endpoints.js';
import { PREVIEW, PREVIEW_LIMITS, previewEstimate, previewLiquidations, previewTraders, previewWalletRisk } from './preview.js';
import { PREVIEW_COST, clientKey, createLimiter } from './rate-limit.js';

type Vars = { config: ResolvedConfig; input: unknown };
type App = { Bindings: Env; Variables: Vars };
type Ctx = Context<App>;

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

const pathMatches = (template: string, path: string) => new RegExp(`^${template.replace('{address}', '[^/]+')}$`).test(path.replace(/\/+$/, ''));
const matchPaid = (method: string, path: string) => PAID_ENDPOINTS.find((e) => e.method === method && pathMatches(e.path, path));

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
    const health = await runHealth(c.get('config'));
    return c.json(health, health.ok ? 200 : 503);
  });

  app.get('/api/v1/markets', async (c) => c.json(await runMarkets(c.get('config'))));

  app.get('/openapi.json', (c) => c.json(buildOpenApi(c.get('config'), new URL(c.req.url).origin)));
  app.get('/.well-known/x402', (c) => c.json(buildDiscovery(c.get('config'), new URL(c.req.url).origin)));

  /* Free preview tier: same live computation, less detail, rate limited. */
  const previews = createLimiter(60, 60_000);
  app.use('/api/v1/preview/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const cost = Object.entries(PREVIEW).find(([, p]) => pathMatches(p.path, new URL(c.req.url).pathname))?.[0];
    const r = previews.take(clientKey(c.req.raw), cost ? PREVIEW_COST[cost as keyof typeof PREVIEW_COST] : 1);
    c.header('X-RateLimit-Limit', String(r.limit));
    c.header('X-RateLimit-Remaining', String(r.remaining));
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter));
      return c.json({ error: 'rate_limited', message: `Free preview rate limit reached. Retry in ${r.retryAfter} seconds, or use the paid endpoint.`, retryAfter: r.retryAfter }, 429);
    }
    return next();
  });
  app.get('/api/v1/preview/wallet/:address/risk', async (c) =>
    c.json(previewWalletRisk(await runWalletRisk(c.get('config'), parseAddress(decodeURIComponent(c.req.param('address')))), c.get('config').prices['wallet-risk'])),
  );
  app.get('/api/v1/preview/liquidations/nearby', async (c) => {
    const query = parseLiquidationQuery(new URL(c.req.url).searchParams);
    query.accounts = Math.min(query.accounts, PREVIEW_LIMITS.liquidationAccounts);
    return c.json(previewLiquidations(await runLiquidationsNearby(c.get('config'), query), c.get('config').prices['liquidations-nearby']));
  });
  app.post('/api/v1/preview/estimate', async (c) => {
    const input = parseEstimateInput(await readJson(c));
    return c.json(previewEstimate(await runEstimate(c.get('config'), input), c.get('config').prices.estimate));
  });
  app.get('/api/v1/preview/traders/top', async (c) => {
    const query = parseTradersQuery(new URL(c.req.url).searchParams);
    query.limit = Math.min(query.limit, PREVIEW_LIMITS.traders);
    return c.json(previewTraders(await runTopTraders(c.get('config'), query), c.get('config').prices['traders-top']));
  });

  /* Paid routes: validate (free 400), require configuration (503), then x402 (402 -> verify -> handler -> settle). */
  app.use('/api/v1/*', async (c, next) => {
    if (c.req.method === 'OPTIONS' || !matchPaid(c.req.method, new URL(c.req.url).pathname)) return next();
    c.set('input', await validate(c));
    const config = c.get('config');
    if (config.problems.length > 0 || activeNetworks(config).length === 0) {
      const origin = new URL(c.req.url).origin;
      const e = matchPaid(c.req.method, new URL(c.req.url).pathname);
      return c.json(
        {
          error: 'not_configured',
          message: 'This deployment accepts valid requests but has no payment address configured yet, so paid routes answer 503 instead of an x402 402 challenge. Nothing was charged.',
          problems: config.problems,
          price: e ? { amount: config.prices[e.id], currency: 'USDC' } : undefined,
          free: { preview: e ? `${origin}${PREVIEW[e.id].path}` : undefined, markets: `${origin}/api/v1/markets`, mcp: `${origin}/mcp`, docs: `${origin}/docs/paying-as-an-agent/` },
          operator: 'Set X402_SOLANA_PAY_TO (and optionally X402_BASE_PAY_TO) as Pages secrets. See /docs/self-hosting/.',
        },
        503,
      );
    }
    return paymentMiddlewareFor(config)(c, next);
  });

  app.get('/api/v1/wallet/:address/risk', async (c) => c.json(await runWalletRisk(c.get('config'), c.get('input') as Address)));
  app.get('/api/v1/liquidations/nearby', async (c) => c.json(await runLiquidationsNearby(c.get('config'), c.get('input') as LiquidationQuery)));
  app.post('/api/v1/estimate', async (c) => c.json(await runEstimate(c.get('config'), c.get('input') as EstimateInput)));
  app.get('/api/v1/traders/top', async (c) => c.json(await runTopTraders(c.get('config'), c.get('input') as TradersQuery)));

  app.notFound((c) => c.json({ error: 'not_found', message: 'Unknown route. See /openapi.json or /.well-known/x402.' }, 404));
  return app;
}
