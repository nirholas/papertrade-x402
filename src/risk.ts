import { distanceToLiquidation, estimateClose, unrealizedPnlUsd, type Instrument, type OpenPosition, type WalletState } from 'papertrade-sdk';
import { wad, type Mark } from './data.js';

export type RiskBand = 'critical' | 'high' | 'elevated' | 'low';

/**
 * Liquidation-risk score from 0 (safe) to 100 (at or past the bust price).
 * Linear in distance to bust: 100 at 0%, 0 at 10% or more away.
 */
export const RISK_SCORE_FULL_DISTANCE = 0.1;

export function riskScore(distanceFraction: number): number {
  if (!(distanceFraction > 0)) return 100;
  return Math.round(100 * Math.max(0, 1 - distanceFraction / RISK_SCORE_FULL_DISTANCE));
}

export function riskBand(score: number): RiskBand {
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 40) return 'elevated';
  return 'low';
}

const round = (n: number, dp: number) => Number(n.toFixed(dp));

export interface PositionRisk {
  positionId: string;
  market: string;
  side: 'long' | 'short';
  leverage: number;
  entryPrice: number;
  markPrice: number | null;
  bustPrice: number;
  /** Percent of mark the market can still move against the position before it busts. Negative when already past bust. */
  bustDistancePct: number | null;
  riskScore: number | null;
  riskBand: RiskBand | null;
  marginUsd: number;
  notionalUsd: number;
  unrealizedPnlUsd: number | null;
  pnlPctOfMargin: number | null;
  /** Notional divided by current equity (margin plus unrealized PnL). */
  effectiveLeverage: number | null;
  /** Net USDC the position would settle for if closed at the mark (after deadband, impact and win fee). */
  estimatedCloseNetUsd: number | null;
  pastBustPrice: boolean;
  openedAt: string;
  ageSeconds: number;
}

export interface WalletRisk {
  wallet: string;
  asOf: string;
  balanceUsd: number;
  availableBalanceUsd: number;
  summary: {
    openPositions: number;
    totalMarginUsd: number;
    totalNotionalUsd: number;
    unrealizedPnlUsd: number;
    /** Total notional over account equity (balance plus unrealized PnL). Null when there is nothing open. */
    accountEffectiveLeverage: number | null;
    maxRiskScore: number;
    maxRiskBand: RiskBand | 'none';
    nearestBustDistancePct: number | null;
    /** Margin held by positions scoring 70 or more. */
    marginAtRiskUsd: number;
  };
  positions: PositionRisk[];
  method: string;
}

export const RISK_METHOD =
  'bustDistancePct = distance from mark to bust price as % of mark; riskScore = 100 * max(0, 1 - distance/10%); effectiveLeverage = notional / (margin + unrealized PnL); bust prices are the protocol values from the live wallet state.';

export function computeWalletRisk(params: {
  state: WalletState;
  instruments: Instrument[];
  marks: Map<number, Mark>;
  nowMs: number;
}): WalletRisk {
  const { state, instruments, marks, nowMs } = params;
  const byId = new Map(instruments.map((i) => [i.id, i]));
  const positions = state.positions.map((p) => positionRisk(p, byId.get(p.instrumentId), marks.get(p.instrumentId), nowMs));

  const totalMarginUsd = positions.reduce((a, p) => a + p.marginUsd, 0);
  const totalNotionalUsd = positions.reduce((a, p) => a + p.notionalUsd, 0);
  const pnl = positions.reduce((a, p) => a + (p.unrealizedPnlUsd ?? 0), 0);
  const scored = positions.filter((p) => p.riskScore !== null);
  const maxRiskScore = scored.reduce((a, p) => Math.max(a, p.riskScore ?? 0), 0);
  const distances = positions.map((p) => p.bustDistancePct).filter((d): d is number => d !== null);
  const equity = wad(state.balance) + pnl;

  return {
    wallet: state.address,
    asOf: new Date(nowMs).toISOString(),
    balanceUsd: round(wad(state.balance), 2),
    availableBalanceUsd: round(wad(state.funds.availableBalance), 2),
    summary: {
      openPositions: positions.length,
      totalMarginUsd: round(totalMarginUsd, 2),
      totalNotionalUsd: round(totalNotionalUsd, 2),
      unrealizedPnlUsd: round(pnl, 2),
      accountEffectiveLeverage: positions.length && equity > 0 ? round(totalNotionalUsd / equity, 2) : null,
      maxRiskScore,
      maxRiskBand: scored.length ? riskBand(maxRiskScore) : 'none',
      nearestBustDistancePct: distances.length ? Math.min(...distances) : null,
      marginAtRiskUsd: round(positions.filter((p) => (p.riskScore ?? 0) >= 70).reduce((a, p) => a + p.marginUsd, 0), 2),
    },
    positions: positions.sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1)),
    method: RISK_METHOD,
  };
}

function positionRisk(p: OpenPosition, instrument: Instrument | undefined, mark: Mark | undefined, nowMs: number): PositionRisk {
  const scale = Number(instrument?.priceScale ?? 1n);
  const marginUsd = wad(p.marginRaw);
  const notionalUsd = marginUsd * p.leverage;
  const base = {
    positionId: p.positionId.toString(),
    market: instrument?.symbol ?? `instrument-${p.instrumentId}`,
    side: p.isLong ? ('long' as const) : ('short' as const),
    leverage: p.leverage,
    entryPrice: Number(p.entryPriceRaw) / scale,
    bustPrice: Number(p.bustPriceRaw) / scale,
    marginUsd: round(marginUsd, 2),
    notionalUsd: round(notionalUsd, 2),
    openedAt: new Date(p.openedAtMs).toISOString(),
    ageSeconds: Math.max(0, Math.round((nowMs - p.openedAtMs) / 1000)),
  };
  if (!mark || !instrument) {
    return {
      ...base,
      markPrice: null,
      bustDistancePct: null,
      riskScore: null,
      riskBand: null,
      unrealizedPnlUsd: null,
      pnlPctOfMargin: null,
      effectiveLeverage: null,
      estimatedCloseNetUsd: null,
      pastBustPrice: false,
    };
  }
  const distance = distanceToLiquidation({ isLong: p.isLong, markPriceRaw: mark.priceRaw, bustPriceRaw: p.bustPriceRaw });
  const pnl = unrealizedPnlUsd({ isLong: p.isLong, entryPriceRaw: p.entryPriceRaw, markPriceRaw: mark.priceRaw, marginRaw: p.marginRaw, leverage: p.leverage });
  const equity = marginUsd + pnl;
  const closed = estimateClose({ instrument, isLong: p.isLong, entryPriceRaw: p.entryPriceRaw, exitPriceRaw: mark.priceRaw, marginRaw: p.marginRaw, leverage: p.leverage });
  const score = riskScore(distance);
  return {
    ...base,
    markPrice: mark.price,
    bustDistancePct: round(distance * 100, 4),
    riskScore: score,
    riskBand: riskBand(score),
    unrealizedPnlUsd: round(pnl, 2),
    pnlPctOfMargin: round((pnl / marginUsd) * 100, 2),
    effectiveLeverage: equity > 0 ? round(notionalUsd / equity, 2) : null,
    estimatedCloseNetUsd: round(closed.netPnlUsd, 2),
    pastBustPrice: closed.liquidated,
  };
}
