import { readFileSync } from 'node:fs';
import type { AccountTrade, Instrument, LeaderboardAccounts, LiquidationMap, ProtocolSummary, TradingState, WalletState } from 'papertrade-sdk';
import type { Mark } from '../src/data.js';

interface Recorded {
  recordedAt: string;
  nowMs: number;
  trading: TradingState;
  summary: ProtocolSummary;
  marks: Record<string, { t: number; price: number }>;
  board24: LeaderboardAccounts;
  wallets: WalletState[];
  liqMaps: Record<string, LiquidationMap>;
  board7: LeaderboardAccounts;
  trades: Record<string, AccountTrade[]>;
}

/** Real responses recorded from https://exchange.papertrade.xyz (bigints are stored as {__bigint}). */
export const live: Recorded = JSON.parse(readFileSync(new URL('./fixtures/papertrade-live.json', import.meta.url), 'utf8'), (_k, v) =>
  v !== null && typeof v === 'object' && '__bigint' in v ? BigInt(v.__bigint as string) : v,
);

export const instrument = (symbol: string): Instrument => {
  const found = live.trading.instruments.find((i) => i.symbol === symbol);
  if (!found) throw new Error(`fixture has no ${symbol}`);
  return found;
};

export const markFor = (i: Instrument): Mark => {
  const p = live.marks[String(i.id)];
  return { instrumentId: i.id, symbol: i.symbol, price: p.price, priceRaw: BigInt(Math.round(p.price * Number(i.priceScale))), atMs: p.t };
};
