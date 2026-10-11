import type { AccountTrade, LeaderboardAccount, LeaderboardWindow } from 'papertrade-sdk';
import { InputError } from './errors.js';
import { wad } from './data.js';

export const WINDOW_MS: Record<LeaderboardWindow, number | null> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, all: null };
const round = (n: number, dp: number) => Number(n.toFixed(dp));

export interface TradersQuery {
  window: LeaderboardWindow;
  limit: number;
}

export function parseTradersQuery(params: URLSearchParams): TradersQuery {
  const allowed = new Set(['window', 'limit']);
  for (const k of params.keys()) if (!allowed.has(k)) throw new InputError(`Unknown query parameter "${k}"`, k);
  const window = (params.get('window') ?? '7d') as LeaderboardWindow;
  if (!(window in WINDOW_MS)) throw new InputError('window must be one of 24h, 7d, 30d, all', 'window');
  const limit = Number(params.get('limit') ?? '10');
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new InputError('limit must be a whole number from 1 to 25', 'limit');
  return { window, limit };
}

export interface TradeStats {
  closedTrades: number;
  wins: number;
  losses: number;
  liquidations: number;
  /** Wins over all closed trades and liquidations. Null when the sample is empty. */
  winRatePct: number | null;
  avgLeverage: number | null;
  /** Leverage weighted by margin, so a $50k 500x trade counts more than a $10 5x one. */
  marginWeightedLeverage: number | null;
  avgHoldMinutes: number | null;
  /** True when the newest 75 trades all fall inside the window, so older ones in the window were not sampled. */
  truncated: boolean;
}

/** Derive stats from the newest page (up to 75) of a wallet's closed trades, restricted to the window. */
export function deriveTradeStats(trades: AccountTrade[], windowMs: number | null, nowMs: number, pageSize = 75): TradeStats {
  const inWindow = windowMs === null ? trades : trades.filter((t) => t.timestampMs >= nowMs - windowMs);
  const wins = inWindow.filter((t) => t.kind === 'PositionClosed' && BigInt(t.adjustedPnlRaw) > 0n).length;
  const liquidations = inWindow.filter((t) => t.kind === 'Liquidated').length;
  const n = inWindow.length;
  const marginSum = inWindow.reduce((a, t) => a + wad(t.marginRaw), 0);
  return {
    closedTrades: n,
    wins,
    losses: n - wins - liquidations,
    liquidations,
    winRatePct: n ? round((wins / n) * 100, 1) : null,
    avgLeverage: n ? round(inWindow.reduce((a, t) => a + t.leverage, 0) / n, 1) : null,
    marginWeightedLeverage: n && marginSum > 0 ? round(inWindow.reduce((a, t) => a + t.leverage * wad(t.marginRaw), 0) / marginSum, 1) : null,
    avgHoldMinutes: n ? round(inWindow.reduce((a, t) => a + (t.timestampMs - t.openedAtMs), 0) / n / 60_000, 1) : null,
    truncated: trades.length >= pageSize && inWindow.length === trades.length,
  };
}

export function computeTopTraders(params: {
  query: TradersQuery;
  accounts: LeaderboardAccount[];
  trades: Map<string, AccountTrade[] | null>;
  totalAccounts: number;
  nowMs: number;
}) {
  const { query, accounts, trades, totalAccounts, nowMs } = params;
  const windowMs = WINDOW_MS[query.window];
  return {
    asOf: new Date(nowMs).toISOString(),
    window: query.window,
    totalAccounts,
    traders: accounts.map((a, i) => {
      const t = trades.get(a.address);
      return {
        rank: i + 1,
        wallet: a.address,
        name: a.leaderboardName,
        windowedPnlUsd: round(wad(a.totalWindowedPnl), 2),
        realizedPnlUsd: round(wad(a.realizedPnl), 2),
        volumeUsd: round(wad(a.totalVolume), 2),
        balanceUsd: round(wad(a.currentBalance), 2),
        open: {
          positions: a.currentOpenPositionCount,
          notionalUsd: round(wad(a.currentOpenNotional), 2),
          unrealizedPnlUsd: round(wad(a.currentUnrealizedPnl), 2),
        },
        lastActive: new Date(a.lastActiveTs * 1000).toISOString(),
        stats: t ? deriveTradeStats(t, windowMs, nowMs) : null,
      };
    }),
    method:
      'Ranked by Papertrade leaderboard windowed PnL. winRatePct, avgLeverage and avgHoldMinutes are derived from each trader\'s newest 75 closed trades inside the window (stats.truncated flags a full page). stats is null if the trade history could not be read.',
  };
}
