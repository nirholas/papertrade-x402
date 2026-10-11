import { describe, expect, it } from 'vitest';
import { PaymentRequiredV2Schema } from '@x402/core/schemas';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { createApp } from '../src/app.js';
import { BASE_MAINNET, SOLANA_MAINNET, type Env } from '../src/config.js';
import { PAID_ENDPOINTS } from '../src/endpoints.js';
import { PapertradeX402, PapertradeX402Error } from '../src/client.js';
import { buildDiscovery } from '../src/discovery.js';
import { buildOpenApi } from '../src/openapi.js';
import { resolveConfig } from '../src/config.js';

const SOL = '3WcepPag9Q9xsAAWsGBhBPdEmMeM3qnaR8u9FGNmTgXk';
const EVM = '0x07977F60757bad9992aFB99A57d83449B69cBC02';
const ADDR = '0x3f139ef9f371fbbfc299aa65b93534e177141b18';
const env: Env = { X402_SOLANA_PAY_TO: SOL, X402_BASE_PAY_TO: EVM, PRICE_WALLET_RISK: '0.02', PRICE_LIQUIDATIONS_NEARBY: '0.05', PRICE_ESTIMATE: '0.005', PRICE_TRADERS_TOP: '0.03' };
const app = createApp();
const call = (path: string, init?: RequestInit, e: Env = env) => app.fetch(new Request(`https://x402.test${path}`, init), e);

const cases = [
  { id: 'wallet-risk', path: `/api/v1/wallet/${ADDR}/risk`, init: undefined, atomic: '20000' },
  { id: 'liquidations-nearby', path: '/api/v1/liquidations/nearby?market=BTC&pct=0.5', init: undefined, atomic: '50000' },
  { id: 'estimate', path: '/api/v1/estimate', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ market: 'BTC', side: 'long', marginUsd: 100, leverage: 100 }) }, atomic: '5000' },
  { id: 'traders-top', path: '/api/v1/traders/top?window=7d', init: undefined, atomic: '30000' },
] as const;

describe('402 challenge (talks to the real PayAI facilitator /supported)', () => {
  for (const c of cases) {
    it(`${c.id}: spec-correct v2 challenge with Solana first and Base second`, async () => {
      const res = await call(c.path, c.init);
      expect(res.status).toBe(402);
      const header = res.headers.get('PAYMENT-REQUIRED');
      expect(header).toBeTruthy();
      const decoded = decodePaymentRequiredHeader(header as string);
      expect(PaymentRequiredV2Schema.safeParse(decoded).success).toBe(true);
      expect(decoded.x402Version).toBe(2);
      expect(decoded.accepts.map((a) => a.network)).toEqual([SOLANA_MAINNET, BASE_MAINNET]);
      expect(decoded.accepts.map((a) => a.payTo)).toEqual([SOL, EVM]);
      expect(decoded.accepts.every((a) => a.scheme === 'exact' && a.amount === c.atomic)).toBe(true);
      expect(decoded.accepts[0].asset).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(decoded.accepts[1].asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      expect(decoded.resource?.url).toContain(new URL(`https://x402.test${c.path}`).pathname);
      expect(decoded.extensions).toHaveProperty('bazaar');
      expect(res.headers.get('access-control-expose-headers')).toContain('PAYMENT-REQUIRED');
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('payment_required');
    }, 30_000);
  }

  it('follows the wrangler price vars', async () => {
    const res = await call(cases[0].path, undefined, { ...env, PRICE_WALLET_RISK: '0.5' });
    const decoded = decodePaymentRequiredHeader(res.headers.get('PAYMENT-REQUIRED') as string);
    expect(decoded.accepts[0].amount).toBe('500000');
  }, 30_000);

  it('offers only Base when only a Base payTo is set', async () => {
    const res = await call(cases[0].path, undefined, { ...env, X402_SOLANA_PAY_TO: undefined });
    const decoded = decodePaymentRequiredHeader(res.headers.get('PAYMENT-REQUIRED') as string);
    expect(decoded.accepts.map((a) => a.network)).toEqual([BASE_MAINNET]);
  }, 30_000);

  it('rejects malformed payment headers through the facilitator verify path, without running the handler', async () => {
    const first = await call(cases[0].path);
    const required = decodePaymentRequiredHeader(first.headers.get('PAYMENT-REQUIRED') as string);
    for (const accepted of required.accepts) {
      const payload =
        accepted.network === SOLANA_MAINNET
          ? { transaction: 'AAAA' }
          : { signature: '0x00', authorization: { from: '0x0000000000000000000000000000000000000001', to: accepted.payTo, value: accepted.amount, validAfter: '0', validBefore: '1', nonce: `0x${'00'.repeat(32)}` } };
      const header = encodePaymentSignatureHeader({ x402Version: 2, resource: required.resource, accepted, payload });
      const res = await call(cases[0].path, { headers: { 'PAYMENT-SIGNATURE': header } });
      expect(res.status).toBe(402);
      const err = decodePaymentRequiredHeader(res.headers.get('PAYMENT-REQUIRED') as string).error ?? '';
      expect(err).toMatch(/^invalid_exact_(svm|evm)_/);
      expect(res.headers.get('PAYMENT-RESPONSE')).toBeNull();
    }
    const garbage = await call(cases[0].path, { headers: { 'PAYMENT-SIGNATURE': 'not-base64-json!!' } });
    expect(garbage.status).toBe(402);
    expect(garbage.headers.get('PAYMENT-RESPONSE')).toBeNull();
  }, 60_000);
});

describe('pre-payment gates', () => {
  it('answers 503 with a config error on every paid endpoint when no payTo is set', async () => {
    for (const c of cases) {
      const res = await call(c.path, c.init, {});
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string; problems: string[] };
      expect(body.error).toBe('not_configured');
      expect(body.problems[0]).toContain('X402_SOLANA_PAY_TO');
      expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
    }
  });

  it('rejects invalid input with 400 before asking for payment', async () => {
    const bad = [
      call('/api/v1/wallet/0x123/risk'),
      call('/api/v1/liquidations/nearby?pct=99'),
      call('/api/v1/traders/top?window=1y'),
      call('/api/v1/estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"market":' }),
      call('/api/v1/estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ market: 'BTC', side: 'sideways', marginUsd: 1, leverage: 1 }) }),
    ];
    for (const res of await Promise.all(bad)) {
      expect(res.status).toBe(400);
      expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
      expect(((await res.json()) as { error: string }).error).toBe('invalid_input');
    }
  });

  it('answers CORS preflight for the payment headers', async () => {
    const res = await call(cases[0].path, { method: 'OPTIONS', headers: { Origin: 'https://agent.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'payment-signature' } });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('payment-signature');
  });

  it('returns JSON 404 for unknown routes', async () => {
    expect((await call('/api/v1/nope')).status).toBe(404);
  });
});

describe('free endpoints (live Papertrade data)', () => {
  it('health reports upstream and x402 state', async () => {
    const res = await call('/api/v1/health');
    const body = (await res.json()) as { ok: boolean; upstream: { ok: boolean; indexedThroughBlock: number }; x402: { configured: boolean; networks: unknown[] } };
    expect(res.status).toBe(200);
    expect(body.upstream.ok).toBe(true);
    expect(body.upstream.indexedThroughBlock).toBeGreaterThan(0);
    expect(body.x402.configured).toBe(true);
    expect(body.x402.networks).toHaveLength(2);
  }, 30_000);

  it('health shows "not configured" with 503 when payTo is unset', async () => {
    const res = await call('/api/v1/health', undefined, {});
    expect(res.status).toBe(503);
    expect(((await res.json()) as { x402: { configured: boolean } }).x402.configured).toBe(false);
  }, 30_000);

  it('markets lists live instruments and mids', async () => {
    const res = await call('/api/v1/markets');
    const body = (await res.json()) as { markets: { symbol: string; markPrice: number; maxLeverage: number }[] };
    expect(res.status).toBe(200);
    const symbols = body.markets.map((m) => m.symbol);
    expect(symbols).toContain('BTC');
    expect(symbols).toContain('ETH');
    for (const m of body.markets) {
      expect(m.markPrice).toBeGreaterThan(0);
      expect(m.maxLeverage).toBeGreaterThan(0);
    }
  }, 30_000);
});

describe('discovery and OpenAPI', () => {
  const config = resolveConfig(env);
  const doc = buildDiscovery(config, 'https://papertrade-x402.pages.dev');

  it('lists every paid resource with price, networks, payTo, description and schemas', () => {
    expect(doc.version).toBe(1);
    expect(doc.resources).toHaveLength(PAID_ENDPOINTS.length);
    for (const e of doc.endpoints) {
      expect(e.price.currency).toBe('USDC');
      expect(e.accepts.map((a) => a.network)).toEqual([SOLANA_MAINNET, BASE_MAINNET]);
      expect(e.accepts.map((a) => a.payTo)).toEqual([SOL, EVM]);
      expect(e.description.length).toBeGreaterThan(20);
      expect(e.input.schema).toBeTruthy();
      expect(e.output.schema).toBeTruthy();
    }
    expect(doc.endpoints.find((e) => e.id === 'estimate')?.price.atomic).toBe('5000');
  });

  it('serves the discovery document and OpenAPI over HTTP', async () => {
    const d = (await (await call('/.well-known/x402')).json()) as { configured: boolean; endpoints: unknown[] };
    expect(d.configured).toBe(true);
    expect(d.endpoints).toHaveLength(4);
    const o = (await (await call('/openapi.json')).json()) as { openapi: string; paths: Record<string, unknown> };
    expect(o.openapi).toBe('3.1.0');
    expect(Object.keys(o.paths)).toContain('/api/v1/wallet/{address}/risk');
    expect(Object.keys(buildOpenApi(config, 'https://x').paths)).toHaveLength(11);
  });

  it('never invents an address when payTo is unset', () => {
    const empty = buildDiscovery(resolveConfig({}), 'https://x');
    expect(empty.configured).toBe(false);
    expect(empty.endpoints[0].accepts).toEqual([]);
    expect(empty.networks.every((n) => n.payTo === null)).toBe(true);
  });
});

describe('client dry run', () => {
  const fetchViaApp: typeof fetch = async (input, init) => app.fetch(new Request(input as string, init), env);

  it('prints payment requirements without signing or paying', async () => {
    const client = new PapertradeX402({ baseUrl: 'https://x402.test', dryRun: true, fetch: fetchViaApp });
    const r = await client.walletRisk(ADDR);
    expect(r.dryRun).toBe(true);
    if (!('dryRun' in r) || !r.dryRun) throw new Error('expected dry run');
    expect(r.summary.map((s) => s.network)).toEqual([SOLANA_MAINNET, BASE_MAINNET]);
    expect(r.summary[0].amountUsdc).toBe('0.02');
    const est = await client.estimate({ market: 'BTC', side: 'long', marginUsd: 100, leverage: 10 });
    expect('summary' in est && est.summary[0].amountUsdc).toBe('0.005');
  }, 30_000);

  it('surfaces input errors as typed errors', async () => {
    const client = new PapertradeX402({ baseUrl: 'https://x402.test', dryRun: true, fetch: fetchViaApp });
    await expect(client.tradersTop({ window: '1y' as never })).rejects.toBeInstanceOf(PapertradeX402Error);
  });

  it('requires a signer unless dryRun is set', () => {
    expect(() => new PapertradeX402({})).toThrow(/svmSigner/);
  });
});
