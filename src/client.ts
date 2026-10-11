import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme, type EvmClientConfig } from '@x402/evm/exact/client';
import { registerExactSvmScheme, type SvmClientConfig } from '@x402/svm/exact/client';

export const DEFAULT_BASE_URL = 'https://papertrade-x402.pages.dev';

export type TraderWindow = '24h' | '7d' | '30d' | 'all';

export interface PapertradeX402Options {
  /** Deployment to call. Defaults to the public instance. */
  baseUrl?: string;
  /** Solana signer (a `@solana/kit` TransactionSigner, for example from `createKeyPairSignerFromBytes`). You supply it; this package never creates keys. */
  svmSigner?: SvmClientConfig['signer'];
  /** EVM signer (a viem account) for Base USDC. */
  evmSigner?: EvmClientConfig['signer'];
  /**
   * Print requirements instead of paying. Paid calls are sent once without a payment header and the
   * 402 requirements are returned. No signer is needed and nothing is signed or sent.
   */
  dryRun?: boolean;
  /** Refuse any requirement whose price exceeds this many USDC (for example 0.1). */
  maxPriceUsdc?: number;
  /** Custom fetch, for tests or proxies. */
  fetch?: typeof globalThis.fetch;
}

export interface DryRunResult {
  dryRun: true;
  url: string;
  method: 'GET' | 'POST';
  /** The decoded x402 PAYMENT-REQUIRED challenge: accepted networks, assets, payTo and atomic amounts. */
  requirements: PaymentRequired;
  /** Human-readable summary of each accepted option. */
  summary: { network: string; asset: string; payTo: string; amountUsdc: string }[];
}

export interface PaidResult<T> {
  dryRun?: false;
  data: T;
  /** Settlement receipt from the PAYMENT-RESPONSE header, when the server settled a payment. */
  receipt?: ReturnType<typeof decodePaymentResponseHeader>;
}

export class PapertradeX402Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'PapertradeX402Error';
  }
}

const USDC_DECIMALS = 6;
const atomicToUsdc = (amount: string) => {
  const padded = amount.padStart(USDC_DECIMALS + 1, '0');
  const whole = padded.slice(0, -USDC_DECIMALS);
  const frac = padded.slice(-USDC_DECIMALS).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
};

export class PapertradeX402 {
  readonly baseUrl: string;
  private readonly rawFetch: typeof globalThis.fetch;
  private readonly payFetch: typeof globalThis.fetch | null;
  private readonly dryRun: boolean;

  constructor(options: PapertradeX402Options = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.rawFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.dryRun = options.dryRun ?? false;
    if (this.dryRun) {
      this.payFetch = null;
      return;
    }
    if (!options.svmSigner && !options.evmSigner) {
      throw new PapertradeX402Error('Provide svmSigner (Solana) or evmSigner (Base), or set dryRun: true to only inspect payment requirements.', 0, null);
    }
    const policies = options.maxPriceUsdc === undefined ? [] : [capPolicy(options.maxPriceUsdc)];
    const client = new x402Client();
    if (options.svmSigner) registerExactSvmScheme(client, { signer: options.svmSigner, policies });
    if (options.evmSigner) registerExactEvmScheme(client, { signer: options.evmSigner, policies });
    this.payFetch = wrapFetchWithPayment(this.rawFetch, client);
  }

  /** Free: service health and x402 configuration. */
  health() {
    return this.free<Record<string, unknown>>('/api/v1/health');
  }

  /** Free: live Papertrade instruments with mark prices and open interest. */
  markets() {
    return this.free<{ markets: Record<string, unknown>[] }>('/api/v1/markets');
  }

  /** Paid: positions with bust distance, liquidation-risk score, effective leverage and PnL. */
  walletRisk(address: string) {
    return this.paid<Record<string, unknown>>('GET', `/api/v1/wallet/${encodeURIComponent(address)}/risk`);
  }

  /** Paid: leaderboard positions whose bust is within `pct` percent of mark, in 20 price buckets. */
  liquidationsNearby(params: { market?: string; pct?: number; accounts?: number } = {}) {
    return this.paid<Record<string, unknown>>('GET', `/api/v1/liquidations/nearby${query(params)}`);
  }

  /** Paid: close/bust estimate for a hypothetical position, including PAPER minted on a loss. */
  estimate(body: { market: string; side: 'long' | 'short'; marginUsd: number; leverage: number; entryPrice?: number; exitPrice?: number; exitMovePct?: number }) {
    return this.paid<Record<string, unknown>>('POST', '/api/v1/estimate', body);
  }

  /** Paid: top traders by windowed PnL with win rate and average leverage. */
  tradersTop(params: { window?: TraderWindow; limit?: number } = {}) {
    return this.paid<Record<string, unknown>>('GET', `/api/v1/traders/top${query(params)}`);
  }

  private async free<T>(path: string): Promise<T> {
    const res = await this.rawFetch(`${this.baseUrl}${path}`);
    return (await parse(res)) as T;
  }

  private async paid<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<PaidResult<T> | DryRunResult> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    };
    if (this.dryRun || !this.payFetch) return this.inspect(url, method, init);
    const res = await this.payFetch(url, init);
    const data = (await parse(res)) as T;
    const header = res.headers.get('PAYMENT-RESPONSE') ?? res.headers.get('X-PAYMENT-RESPONSE');
    return { data, ...(header ? { receipt: decodePaymentResponseHeader(header) } : {}) };
  }

  private async inspect(url: string, method: 'GET' | 'POST', init: RequestInit): Promise<DryRunResult> {
    const res = await this.rawFetch(url, init);
    const header = res.headers.get('PAYMENT-REQUIRED');
    if (res.status !== 402 || !header) await parse(res);
    if (!header) throw new PapertradeX402Error(`Expected a 402 challenge from ${url}, got ${res.status}`, res.status, null);
    const requirements = decodePaymentRequiredHeader(header);
    return {
      dryRun: true,
      url,
      method,
      requirements,
      summary: requirements.accepts.map((a) => ({ network: a.network, asset: a.asset, payTo: a.payTo, amountUsdc: atomicToUsdc(a.amount) })),
    };
  }
}

function capPolicy(maxUsdc: number) {
  const maxAtomic = BigInt(Math.round(maxUsdc * 10 ** USDC_DECIMALS));
  return (_version: number, reqs: PaymentRequirements[]) => {
    const ok = reqs.filter((r) => BigInt(r.amount) <= maxAtomic);
    if (ok.length === 0) throw new PapertradeX402Error(`Every payment option exceeds the ${maxUsdc} USDC cap`, 402, reqs);
    return ok;
  };
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const message = typeof json === 'object' && json !== null && 'message' in json ? String((json as { message: unknown }).message) : `HTTP ${res.status}`;
    throw new PapertradeX402Error(message, res.status, json);
  }
  return json;
}

/** Convenience factory. */
export const createPapertradeX402 = (options?: PapertradeX402Options) => new PapertradeX402(options);
