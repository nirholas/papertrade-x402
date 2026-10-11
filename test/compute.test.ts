import { describe, expect, it } from 'vitest';
import { liquidationPriceRaw } from 'papertrade-sdk';
import { computeWalletRisk, riskBand, riskScore } from '../src/risk.js';
import { computeEstimate, findInstrument, parseEstimateInput } from '../src/estimate.js';
import { buildBuckets, computeLiquidationMap, mapRangeFor, parseLiquidationQuery, scanPositions } from '../src/liquidations.js';
import { computeTopTraders, deriveTradeStats, parseTradersQuery } from '../src/traders.js';
import { InputError } from '../src/errors.js';
import { instrument, live, markFor } from './helpers.js';

const btc = instrument('BTC');
const eth = instrument('ETH');
const marks = new Map([btc, eth].map((i) => [i.id, markFor(i)]));

describe('risk score', () => {
  it('is 100 at the bust price, 0 at 10% or more away, and monotone', () => {
    expect(riskScore(0)).toBe(100);
    expect(riskScore(0.1)).toBe(0);
    expect(riskScore(0.5)).toBe(0);
    expect(riskScore(0.01)).toBeGreaterThan(riskScore(0.02));
    expect(riskBand(100)).toBe('critical');
    expect(riskBand(0)).toBe('low');
  });
});

describe('wallet risk on recorded live wallets', () => {
  const wallet = live.wallets.find((w) => w.positions.length > 0)!;
  const risk = computeWalletRisk({ state: wallet, instruments: live.trading.instruments, marks, nowMs: live.nowMs });

  it('covers every open position', () => {
    expect(risk.wallet).toBe(wallet.address);
    expect(risk.positions).toHaveLength(wallet.positions.length);
    expect(risk.summary.openPositions).toBe(wallet.positions.length);
  });

  it('uses the protocol bust price and a consistent distance for each position', () => {
    for (const p of risk.positions) {
      const raw = wallet.positions.find((x) => x.positionId.toString() === p.positionId)!;
      const scale = Number(instrument(p.market).priceScale);
      expect(p.bustPrice).toBeCloseTo(Number(raw.bustPriceRaw) / scale, 6);
      const mark = markFor(instrument(p.market)).price;
      expect(p.bustDistancePct).toBeCloseTo((Math.abs(mark - p.bustPrice) / mark) * 100, 2);
      expect(p.riskScore).toBeGreaterThanOrEqual(0);
      expect(p.riskScore).toBeLessThanOrEqual(100);
    }
  });

  it('aggregates notional and picks the nearest bust', () => {
    const notional = risk.positions.reduce((a, p) => a + p.notionalUsd, 0);
    expect(risk.summary.totalNotionalUsd).toBeCloseTo(notional, 0);
    const nearest = Math.min(...risk.positions.map((p) => p.bustDistancePct!));
    expect(risk.summary.nearestBustDistancePct).toBeCloseTo(nearest, 3);
  });
});

describe('estimate', () => {
  const trading = live.trading;
  const run = (body: unknown, symbol = 'BTC') => {
    const input = parseEstimateInput(body);
    const instr = findInstrument(trading, symbol);
    return computeEstimate({ input, trading, mark: markFor(instr), instrument: instr, summary: live.summary, nowMs: live.nowMs });
  };

  it('matches the SDK bust formula for a long and a short', () => {
    const mark = markFor(btc);
    const entryRaw = BigInt(Math.round(mark.price * Number(btc.priceScale)));
    for (const side of ['long', 'short'] as const) {
      const r = run({ market: 'BTC', side, marginUsd: 100, leverage: 100 });
      const bust = Number(liquidationPriceRaw({ entryPriceRaw: entryRaw, leverage: 100, isLong: side === 'long', bustBufferRaw: btc.bustBufferRaw })) / Number(btc.priceScale);
      expect(r.bustPrice).toBeCloseTo(bust, 6);
      expect(side === 'long' ? r.bustPrice < mark.price : r.bustPrice > mark.price).toBe(true);
    }
  });

  it('mints PAPER on a loss and not on a win', () => {
    const loss = run({ market: 'BTC', side: 'long', marginUsd: 100, leverage: 50, exitMovePct: -1 });
    expect(loss.close?.outcome).toBe('loss');
    expect(loss.close!.paperMinted).toBeGreaterThan(0);
    const win = run({ market: 'BTC', side: 'long', marginUsd: 100, leverage: 50, exitMovePct: 1 });
    expect(win.close?.outcome).toBe('win');
    expect(win.close!.paperMinted).toBe(0);
    expect(win.close!.winFeeUsd).toBeGreaterThan(0);
  });

  it('liquidates when the exit crosses bust and forfeits the margin', () => {
    const r = run({ market: 'ETH', side: 'short', marginUsd: 50, leverage: 500, exitMovePct: 2 }, 'ETH');
    expect(r.close?.outcome).toBe('liquidated');
    expect(r.close!.netPnlUsd).toBeCloseTo(-50, 1);
  });

  it('flags trades Papertrade would refuse', () => {
    const r = run({ market: 'BTC', side: 'long', marginUsd: 1, leverage: 2 });
    expect(r.wouldBeAccepted).toBe(false);
    expect(r.openIssues.length).toBeGreaterThan(0);
  });

  it('rejects bad input with a field name', () => {
    expect(() => parseEstimateInput({ market: 'BTC', side: 'up', marginUsd: 100, leverage: 10 })).toThrow(InputError);
    expect(() => parseEstimateInput({ market: 'BTC', side: 'long', marginUsd: -1, leverage: 10 })).toThrow(InputError);
    expect(() => parseEstimateInput({ market: 'BTC', side: 'long', marginUsd: 10, leverage: 5000 })).toThrow(InputError);
    expect(() => parseEstimateInput({ market: 'BTC', side: 'long', marginUsd: 10, leverage: 5, exitPrice: 1, exitMovePct: 1 })).toThrow(InputError);
    expect(() => parseEstimateInput({ market: 'BTC', side: 'long', marginUsd: 10, leverage: 5, extra: 1 })).toThrow(InputError);
    expect(() => parseEstimateInput('x')).toThrow(InputError);
    expect(() => findInstrument(live.trading, 'DOGE')).toThrow(/Unknown market/);
  });
});

describe('liquidation map on recorded leaderboard positions', () => {
  const query = parseLiquidationQuery(new URLSearchParams('market=BTC&pct=1'));
  const mark = markFor(btc);
  const map = computeLiquidationMap({ query, instrument: btc, mark, wallets: live.wallets, protocol: live.liqMaps['1'], accountsRequested: 12, nowMs: live.nowMs });

  it('parses and bounds the query', () => {
    expect(parseLiquidationQuery(new URLSearchParams())).toEqual({ market: 'BTC', pct: 0.5, accounts: 20 });
    expect(() => parseLiquidationQuery(new URLSearchParams('pct=0'))).toThrow(InputError);
    expect(() => parseLiquidationQuery(new URLSearchParams('pct=30'))).toThrow(InputError);
    expect(() => parseLiquidationQuery(new URLSearchParams('market=1'))).toThrow(InputError);
    expect(() => parseLiquidationQuery(new URLSearchParams('foo=1'))).toThrow(InputError);
    expect(mapRangeFor(0.5)).toBe('0.5');
    expect(mapRangeFor(3)).toBe('5');
  });

  it('only counts positions whose bust is within pct of mark', () => {
    const positions = scanPositions(live.wallets, btc);
    const inside = positions.filter((p) => Math.abs(p.bustPrice - mark.price) / mark.price <= 0.01);
    expect(map.scanned.positionsInWindow).toBe(inside.length);
    expect(map.totals.longs.count + map.totals.shorts.count).toBe(inside.length);
    for (const n of map.nearest) expect(n.bustDistancePct).toBeLessThanOrEqual(1);
  });

  it('splits the window into 20 buckets that sum to the totals', () => {
    expect(map.buckets).toHaveLength(20);
    const notional = map.buckets.reduce((a, b) => a + b.longNotionalUsd + b.shortNotionalUsd, 0);
    expect(notional).toBeCloseTo(map.totals.longs.notionalUsd + map.totals.shorts.notionalUsd, 0);
    expect(buildBuckets([], mark.price, 0.01)).toHaveLength(20);
  });

  it('includes protocol-wide totals from the API map', () => {
    expect(map.protocolWide.longCount + map.protocolWide.shortCount).toBeGreaterThanOrEqual(0);
    expect(map.protocolWide.longNotionalUsd + map.protocolWide.shortNotionalUsd).toBeGreaterThanOrEqual(map.totals.longs.notionalUsd + map.totals.shorts.notionalUsd - 1);
    expect(map.window.low).toBeLessThan(mark.price);
    expect(map.window.high).toBeGreaterThan(mark.price);
  });
});

describe('top traders on recorded leaderboard and trades', () => {
  const query = parseTradersQuery(new URLSearchParams('window=7d'));
  const trades = new Map(live.board7.accounts.map((a) => [a.address, live.trades[a.address] ?? null]));
  const top = computeTopTraders({ query, accounts: live.board7.accounts, trades, totalAccounts: live.board7.summary.uniqueAccounts, nowMs: live.nowMs });

  it('keeps leaderboard order and ranks from 1', () => {
    expect(top.traders.map((t) => t.rank)).toEqual(live.board7.accounts.map((_, i) => i + 1));
    const pnl = top.traders.map((t) => t.windowedPnlUsd);
    expect([...pnl].sort((a, b) => b - a)).toEqual(pnl);
  });

  it('derives win rate and leverage from closed trades inside the window', () => {
    for (const t of top.traders) {
      if (!t.stats || t.stats.closedTrades === 0) continue;
      expect(t.stats.winRatePct).toBeGreaterThanOrEqual(0);
      expect(t.stats.winRatePct).toBeLessThanOrEqual(100);
      expect(t.stats.avgLeverage).toBeGreaterThan(0);
      expect(t.stats.wins + t.stats.losses + t.stats.liquidations).toBeLessThanOrEqual(t.stats.closedTrades);
    }
  });

  it('handles an empty trade list and a missing history', () => {
    const empty = deriveTradeStats([], 7 * 86_400_000, live.nowMs);
    expect(empty.closedTrades).toBe(0);
    expect(empty.winRatePct).toBeNull();
    const missing = computeTopTraders({ query, accounts: live.board7.accounts.slice(0, 1), trades: new Map(), totalAccounts: 1, nowMs: live.nowMs });
    expect(missing.traders[0].stats).toBeNull();
  });

  it('validates window and limit', () => {
    expect(() => parseTradersQuery(new URLSearchParams('window=1y'))).toThrow(InputError);
    expect(() => parseTradersQuery(new URLSearchParams('limit=100'))).toThrow(InputError);
    expect(parseTradersQuery(new URLSearchParams())).toEqual({ window: '7d', limit: 10 });
  });
});
