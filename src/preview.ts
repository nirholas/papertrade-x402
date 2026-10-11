import type { EndpointId } from './config.js';
import type { WalletRisk } from './risk.js';

/**
 * Free preview tier. Each preview runs the same live computation as its paid endpoint and then
 * withholds the detail that makes the paid answer worth paying for. Previews are rate limited.
 */

export const PREVIEW_LIMITS = {
  /** Leaderboard accounts scanned for the liquidation-map preview (paid scans up to 25). */
  liquidationAccounts: 5,
  /** Traders returned by the leaderboard preview (paid returns up to 25). */
  traders: 3,
} as const;

export interface PreviewMeta {
  method: 'GET' | 'POST';
  path: string;
  /** Fields the paid response adds on top of the preview. */
  omits: string[];
}

export const PREVIEW: Record<EndpointId, PreviewMeta> = {
  'wallet-risk': { method: 'GET', path: '/api/v1/preview/wallet/{address}/risk', omits: ['per-position bust prices, scores and settlement estimates'] },
  'liquidations-nearby': { method: 'GET', path: '/api/v1/preview/liquidations/nearby', omits: ['price buckets', 'nearest positions', `scan of more than ${PREVIEW_LIMITS.liquidationAccounts} accounts`] },
  estimate: { method: 'POST', path: '/api/v1/preview/estimate', omits: ['close at a chosen exit', 'PAPER mint estimate', 'price-move scenario ladder'] },
  'traders-top': { method: 'GET', path: '/api/v1/preview/traders/top', omits: [`ranks beyond ${PREVIEW_LIMITS.traders}`, 'derived win rate, leverage and hold-time stats', 'open exposure'] },
};

const meta = (id: EndpointId, paidPrice: string) => ({
  tier: 'free-preview' as const,
  omitted: PREVIEW[id].omits,
  paid: { endpoint: id, priceUsdc: paidPrice },
});

type Obj = Record<string, any>;

export function previewWalletRisk(full: WalletRisk, price: string) {
  const { positions: _positions, method: _method, ...rest } = full;
  return { ...rest, preview: meta('wallet-risk', price) };
}

export function previewLiquidations(full: Obj, price: string) {
  const { buckets: _b, nearest, protocolWide, method: _m, ...rest } = full;
  return { ...rest, nearestCount: Array.isArray(nearest) ? nearest.length : 0, protocolWide, preview: meta('liquidations-nearby', price) };
}

export function previewEstimate(full: Obj, price: string) {
  const { close: _c, scenarios: _s, paper: _p, method: _m, ...rest } = full;
  return { ...rest, preview: meta('estimate', price) };
}

export function previewTraders(full: Obj, price: string) {
  const traders = (full.traders as Obj[]).slice(0, PREVIEW_LIMITS.traders).map((t) => ({ rank: t.rank, wallet: t.wallet, name: t.name, windowedPnlUsd: t.windowedPnlUsd }));
  return { asOf: full.asOf, window: full.window, totalAccounts: full.totalAccounts, traders, preview: meta('traders-top', price) };
}
