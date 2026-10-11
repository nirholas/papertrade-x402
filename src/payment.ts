import { activeNetworks, BASE_MAINNET, SOLANA_MAINNET, type ResolvedConfig } from './config.js';
import type { PaidEndpoint } from './endpoints.js';

export const MAX_TIMEOUT_SECONDS = 90;

export const USDC: Record<string, { symbol: 'USDC'; address: string; decimals: 6 }> = {
  [SOLANA_MAINNET]: { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  [BASE_MAINNET]: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
};

export const toAtomic = (price: string): string => {
  const [whole, frac = ''] = price.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'))).toString();
};

export interface PaymentRequirements {
  x402Version: 2;
  /** `ready` when a payTo is configured; `payments_not_configured` when the operator has not set one yet. */
  status: 'ready' | 'payments_not_configured';
  endpoint: string;
  request: { method: 'GET' | 'POST'; url: string; body?: Record<string, unknown> };
  price: { amount: string; atomic: string; currency: 'USDC' };
  accepts: { scheme: 'exact'; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number }[];
  howToPay: string;
  note: string;
}

/**
 * The x402 payment requirements for one paid endpoint, built from configuration only.
 * Nothing here signs or sends anything: it tells a caller what to pay and where.
 */
export function paymentRequirements(config: ResolvedConfig, e: PaidEndpoint, origin: string, url: string, body?: Record<string, unknown>): PaymentRequirements {
  const base = origin.replace(/\/+$/, '');
  const active = activeNetworks(config);
  const atomic = toAtomic(config.prices[e.id]);
  const ready = active.length > 0 && config.problems.length === 0;
  return {
    x402Version: 2,
    status: ready ? 'ready' : 'payments_not_configured',
    endpoint: e.id,
    request: { method: e.method, url, ...(body ? { body } : {}) },
    price: { amount: config.prices[e.id], atomic, currency: 'USDC' },
    accepts: ready
      ? active.map((n) => ({ scheme: 'exact' as const, network: n.network, asset: USDC[n.network].address, amount: atomic, payTo: n.payTo as string, maxTimeoutSeconds: MAX_TIMEOUT_SECONDS }))
      : [],
    howToPay: `Send the request above with an x402 client that holds your own wallet (for example @x402/fetch wrapFetchWithPayment). The server answers 402 with a base64 PAYMENT-REQUIRED header, your client signs one accepts entry and retries with PAYMENT-SIGNATURE. Docs: ${base}/docs/paying-as-an-agent/`,
    note: ready
      ? 'This tool only returns requirements. It never signs, sends or pays. You are charged only if you make the paid request yourself and it succeeds.'
      : `This deployment has no payment address configured yet, so the paid route answers 503 and no payTo can be shown. The free preview tool for this endpoint works now. Price once enabled: ${config.prices[e.id]} USDC per call.`,
  };
}
