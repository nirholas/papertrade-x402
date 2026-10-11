import { activeNetworks, VERSION, type ResolvedConfig } from './config.js';
import { PAID_ENDPOINTS } from './endpoints.js';

const USDC: Record<string, { symbol: 'USDC'; address: string; decimals: 6 }> = {
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  'eip155:8453': { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
};

const toAtomic = (price: string): string => {
  const [whole, frac = ''] = price.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'))).toString();
};

/**
 * Discovery document served at /.well-known/x402.
 *
 * `version` + `resources` (absolute URLs) follows the convention that x402 crawlers and CLIs read;
 * `x402Version` + `endpoints` carries everything an agent needs to decide without probing:
 * price, accepted networks, payTo, description and input/output schemas.
 */
export function buildDiscovery(config: ResolvedConfig, origin: string) {
  const active = activeNetworks(config);
  const base = origin.replace(/\/+$/, '');
  return {
    version: 1,
    x402Version: 2,
    name: 'papertrade-x402',
    description:
      'Unofficial pay-per-call intelligence API over Papertrade (the 1000x synthetic perps exchange on HyperEVM): wallet liquidation risk, liquidation maps, settlement estimates and top-trader stats. Paid per request in USDC via x402 on Solana (first) or Base.',
    serviceVersion: VERSION,
    facilitator: config.facilitatorUrl,
    configured: active.length > 0,
    networks: config.networks.map((n) => ({ network: n.network, label: n.label, payTo: n.configured ? n.payTo : null, configured: n.configured })),
    resources: PAID_ENDPOINTS.map((e) => `${base}${e.path.replace('{address}', ':address')}`),
    instructions: `Call a resource without payment to receive HTTP 402 with a base64 PAYMENT-REQUIRED header. Sign the payment for one of the accepts entries and retry with the PAYMENT-SIGNATURE header. The payment settles only after a successful (2xx) response. Free endpoints: ${base}/api/v1/health, ${base}/api/v1/markets, ${base}/openapi.json.`,
    openapi: `${base}/openapi.json`,
    endpoints: PAID_ENDPOINTS.map((e) => ({
      id: e.id,
      resource: `${base}${e.path}`,
      method: e.method,
      description: e.description,
      price: { amount: config.prices[e.id], atomic: toAtomic(config.prices[e.id]), currency: 'USDC' },
      accepts: active.map((n) => ({
        scheme: 'exact',
        network: n.network,
        payTo: n.payTo,
        asset: USDC[n.network].address,
        maxAmountRequired: toAtomic(config.prices[e.id]),
      })),
      mimeType: 'application/json',
      input: { type: 'http', method: e.method, ...(e.bodyType ? { bodyType: e.bodyType } : {}), schema: e.inputSchema, example: e.inputExample },
      output: { type: 'json', schema: e.outputSchema },
      tags: e.tags,
    })),
    free: [
      { method: 'GET', resource: `${base}/api/v1/health` },
      { method: 'GET', resource: `${base}/api/v1/markets` },
      { method: 'GET', resource: `${base}/openapi.json` },
    ],
  };
}
