import type { Instrument, LiquidationMap, LiquidationMapRange, OpenPosition, WalletState } from 'papertrade-sdk';
import { InputError } from './errors.js';
import { wad, type Mark } from './data.js';

export const MAP_RANGES: LiquidationMapRange[] = ['0.1', '0.25', '0.5', '1', '2', '5', '10', '25'];
export const BUCKET_COUNT = 20;
const round = (n: number, dp: number) => Number(n.toFixed(dp));

export interface LiquidationQuery {
  market: string;
  /** Percent of mark, for example 0.5 means within 0.5%. */
  pct: number;
  /** Leaderboard accounts to scan for positions. */
  accounts: number;
}

export function parseLiquidationQuery(params: URLSearchParams): LiquidationQuery {
  const allowed = new Set(['market', 'pct', 'accounts']);
  for (const k of params.keys()) if (!allowed.has(k)) throw new InputError(`Unknown query parameter "${k}"`, k);
  const market = (params.get('market') ?? 'BTC').toUpperCase();
  if (!/^[A-Z]{2,12}$/.test(market)) throw new InputError('market must be a symbol such as BTC or ETH', 'market');
  const pct = Number(params.get('pct') ?? '0.5');
  if (!Number.isFinite(pct) || pct <= 0 || pct > 25) throw new InputError('pct must be a number above 0 and at most 25 (percent of mark)', 'pct');
  const accounts = Number(params.get('accounts') ?? '20');
  if (!Number.isInteger(accounts) || accounts < 1 || accounts > 25) throw new InputError('accounts must be a whole number from 1 to 25', 'accounts');
  return { market, pct, accounts };
}

/** Smallest liquidation-map range from the API that covers `pct`. */
export function mapRangeFor(pct: number): LiquidationMapRange {
  return MAP_RANGES.find((r) => Number(r) >= pct) ?? '25';
}

export interface ScannedPosition {
  address: string;
  positionId: string;
  isLong: boolean;
  leverage: number;
  bustPrice: number;
  marginUsd: number;
  notionalUsd: number;
}

/** Positions of one market from the wallets' live snapshots. */
export function scanPositions(wallets: WalletState[], instrument: Instrument): ScannedPosition[] {
  const scale = Number(instrument.priceScale);
  const out: ScannedPosition[] = [];
  for (const w of wallets) {
    for (const p of w.positions as OpenPosition[]) {
      if (p.instrumentId !== instrument.id) continue;
      const marginUsd = wad(p.marginRaw);
      out.push({
        address: w.address,
        positionId: p.positionId.toString(),
        isLong: p.isLong,
        leverage: p.leverage,
        bustPrice: Number(p.bustPriceRaw) / scale,
        marginUsd,
        notionalUsd: marginUsd * p.leverage,
      });
    }
  }
  return out;
}

export interface PriceBucket {
  from: number;
  to: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  longCount: number;
  shortCount: number;
}

/** Bucket the in-window positions into BUCKET_COUNT equal price bins from mark*(1-pct) to mark*(1+pct). */
export function buildBuckets(positions: ScannedPosition[], mark: number, pctFraction: number): PriceBucket[] {
  const low = mark * (1 - pctFraction);
  const high = mark * (1 + pctFraction);
  const width = (high - low) / BUCKET_COUNT;
  const buckets: PriceBucket[] = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
    from: low + i * width,
    to: low + (i + 1) * width,
    longNotionalUsd: 0,
    shortNotionalUsd: 0,
    longCount: 0,
    shortCount: 0,
  }));
  for (const p of positions) {
    if (p.bustPrice < low || p.bustPrice > high) continue;
    const idx = Math.min(BUCKET_COUNT - 1, Math.floor((p.bustPrice - low) / width));
    const b = buckets[idx];
    if (p.isLong) {
      b.longNotionalUsd += p.notionalUsd;
      b.longCount += 1;
    } else {
      b.shortNotionalUsd += p.notionalUsd;
      b.shortCount += 1;
    }
  }
  return buckets.map((b) => ({
    from: round(b.from, 4),
    to: round(b.to, 4),
    longNotionalUsd: round(b.longNotionalUsd, 2),
    shortNotionalUsd: round(b.shortNotionalUsd, 2),
    longCount: b.longCount,
    shortCount: b.shortCount,
  }));
}

/** Protocol-wide totals inside the window, from Papertrade's own liquidation map (covers every open position, not only the scanned ones). */
export function protocolWindow(map: LiquidationMap, mark: number, pctFraction: number) {
  const scale = Number(map.priceScale);
  const from = Number(map.fromRaw) / scale;
  const to = Number(map.toRaw) / scale;
  const width = (to - from) / map.buckets.length;
  const low = mark * (1 - pctFraction);
  const high = mark * (1 + pctFraction);
  let longUsd = 0;
  let shortUsd = 0;
  let longCount = 0;
  let shortCount = 0;
  map.buckets.forEach((b, i) => {
    const center = from + (i + 0.5) * width;
    if (center < low || center > high) return;
    longUsd += wad(b[0]);
    shortUsd += wad(b[1]);
    longCount += b[2];
    shortCount += b[3];
  });
  return {
    longNotionalUsd: round(longUsd, 2),
    shortNotionalUsd: round(shortUsd, 2),
    longCount,
    shortCount,
    resolution: `API buckets of ${round((width / mark) * 100, 4)}% of mark; a bucket counts when its center is in the window`,
  };
}

export function computeLiquidationMap(params: {
  query: LiquidationQuery;
  instrument: Instrument;
  mark: Mark;
  wallets: WalletState[];
  protocol: LiquidationMap;
  accountsRequested: number;
  nowMs: number;
}) {
  const { query, instrument, mark, wallets, protocol, accountsRequested, nowMs } = params;
  const pctFraction = query.pct / 100;
  const positions = scanPositions(wallets, instrument);
  const inWindow = positions.filter((p) => Math.abs(p.bustPrice - mark.price) / mark.price <= pctFraction);
  const longs = inWindow.filter((p) => p.isLong);
  const shorts = inWindow.filter((p) => !p.isLong);
  const sum = (xs: ScannedPosition[], k: 'notionalUsd' | 'marginUsd') => round(xs.reduce((a, p) => a + p[k], 0), 2);

  return {
    asOf: new Date(nowMs).toISOString(),
    market: instrument.symbol,
    markPrice: mark.price,
    window: { pct: query.pct, low: round(mark.price * (1 - pctFraction), 4), high: round(mark.price * (1 + pctFraction), 4) },
    scanned: {
      source: 'open positions of the top leaderboard accounts by open notional (24h window)',
      accounts: wallets.length,
      accountsRequested,
      partial: wallets.length < accountsRequested,
      positionsInMarket: positions.length,
      positionsInWindow: inWindow.length,
    },
    totals: {
      longs: { count: longs.length, notionalUsd: sum(longs, 'notionalUsd'), marginUsd: sum(longs, 'marginUsd') },
      shorts: { count: shorts.length, notionalUsd: sum(shorts, 'notionalUsd'), marginUsd: sum(shorts, 'marginUsd') },
    },
    buckets: buildBuckets(inWindow, mark.price, pctFraction),
    nearest: inWindow
      .map((p) => ({ ...p, bustDistancePct: round((Math.abs(p.bustPrice - mark.price) / mark.price) * 100, 4) }))
      .sort((a, b) => a.bustDistancePct - b.bustDistancePct)
      .slice(0, 10)
      .map((p) => ({
        wallet: p.address,
        positionId: p.positionId,
        side: p.isLong ? 'long' : 'short',
        leverage: p.leverage,
        bustPrice: p.bustPrice,
        bustDistancePct: p.bustDistancePct,
        marginUsd: round(p.marginUsd, 2),
        notionalUsd: round(p.notionalUsd, 2),
      })),
    protocolWide: protocolWindow(protocol, mark.price, pctFraction),
    method:
      'A long busts below mark and a short above. Bust prices come from the live wallet snapshots (exact protocol values). Buckets split mark*(1-pct) to mark*(1+pct) into 20 equal bins. protocolWide comes from Papertrade liquidation-map and covers every open position.',
  };
}
