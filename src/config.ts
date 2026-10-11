import { isAddress as isEvmAddress } from 'viem';
import { isAddress as isSolanaAddress } from '@solana/kit';

/** CAIP-2 ids. Solana mainnet is the primary network, Base the secondary. */
export const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
export const BASE_MAINNET = 'eip155:8453' as const;
export const DEFAULT_FACILITATOR_URL = 'https://facilitator.payai.network';
export const DEFAULT_API_URL = 'https://exchange.papertrade.xyz';
export const VERSION = '0.1.0';

/** Worker environment bindings (wrangler vars and secrets). */
export interface Env {
  X402_SOLANA_PAY_TO?: string;
  X402_BASE_PAY_TO?: string;
  X402_FACILITATOR_URL?: string;
  PAPERTRADE_API_URL?: string;
  PRICE_WALLET_RISK?: string;
  PRICE_LIQUIDATIONS_NEARBY?: string;
  PRICE_ESTIMATE?: string;
  PRICE_TRADERS_TOP?: string;
}

export type EndpointId = 'wallet-risk' | 'liquidations-nearby' | 'estimate' | 'traders-top';

export const PRICE_VARS: Record<EndpointId, keyof Env> = {
  'wallet-risk': 'PRICE_WALLET_RISK',
  'liquidations-nearby': 'PRICE_LIQUIDATIONS_NEARBY',
  estimate: 'PRICE_ESTIMATE',
  'traders-top': 'PRICE_TRADERS_TOP',
};

/** Used only when a price var is absent. wrangler.toml carries the authoritative values. */
export const DEFAULT_PRICES: Record<EndpointId, string> = {
  'wallet-risk': '0.02',
  'liquidations-nearby': '0.05',
  estimate: '0.005',
  'traders-top': '0.03',
};

export interface NetworkConfig {
  /** Short label used in responses and docs. */
  label: 'solana' | 'base';
  network: typeof SOLANA_MAINNET | typeof BASE_MAINNET;
  payTo: string | null;
  /** True when payTo is set and a valid address for this chain. */
  configured: boolean;
  /** Present when payTo is set but invalid. */
  error: string | null;
}

export interface ResolvedConfig {
  networks: NetworkConfig[];
  facilitatorUrl: string;
  apiUrl: string;
  prices: Record<EndpointId, string>;
  /** Human-readable configuration problems (invalid prices or addresses). Empty when healthy. */
  problems: string[];
}

const PRICE_RE = /^\d{1,4}(\.\d{1,6})?$/;

/** Validate a USDC price string like "0.02". Returns the normalized string or null. */
export function parsePrice(value: string | undefined): string | null {
  if (value === undefined) return null;
  const v = value.trim().replace(/^\$/, '');
  if (!PRICE_RE.test(v) || Number(v) <= 0) return null;
  return v;
}

function networkConfig(label: 'solana' | 'base', raw: string | undefined): NetworkConfig {
  const network = label === 'solana' ? SOLANA_MAINNET : BASE_MAINNET;
  const value = raw?.trim();
  if (!value) return { label, network, payTo: null, configured: false, error: null };
  const valid = label === 'solana' ? isSolanaAddress(value) : isEvmAddress(value, { strict: false });
  if (!valid) return { label, network, payTo: value, configured: false, error: `${label === 'solana' ? 'X402_SOLANA_PAY_TO' : 'X402_BASE_PAY_TO'} is not a valid ${label} address` };
  return { label, network, payTo: value, configured: true, error: null };
}

export function resolveConfig(env: Env): ResolvedConfig {
  const problems: string[] = [];
  const networks = [networkConfig('solana', env.X402_SOLANA_PAY_TO), networkConfig('base', env.X402_BASE_PAY_TO)];
  for (const n of networks) if (n.error) problems.push(n.error);
  const prices = { ...DEFAULT_PRICES };
  for (const id of Object.keys(PRICE_VARS) as EndpointId[]) {
    const raw = env[PRICE_VARS[id]] as string | undefined;
    if (raw === undefined || raw === '') continue;
    const parsed = parsePrice(raw);
    if (parsed === null) problems.push(`${PRICE_VARS[id]} must be a positive USDC amount such as 0.02, got "${raw}"`);
    else prices[id] = parsed;
  }
  if (!networks.some((n) => n.configured)) {
    problems.push('No payment address configured: set X402_SOLANA_PAY_TO (Solana USDC) and/or X402_BASE_PAY_TO (Base USDC)');
  }
  return {
    networks,
    facilitatorUrl: (env.X402_FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR_URL).replace(/\/+$/, ''),
    apiUrl: (env.PAPERTRADE_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, ''),
    prices,
    problems,
  };
}

/** Networks that can accept payment right now, Solana first. */
export const activeNetworks = (config: ResolvedConfig) => config.networks.filter((n) => n.configured);
