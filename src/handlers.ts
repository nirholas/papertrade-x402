import type { AccountTrade, LeaderboardAccount, WalletState } from 'papertrade-sdk';
import { isAddress, type Address } from 'viem';
import { activeNetworks, VERSION, type ResolvedConfig } from './config.js';
import { InputError, UpstreamError } from './errors.js';
import { loadMark, loadMarks, loadProtocolSummary, loadTradingState, loadWallet, makeClient, wad, wrapUpstream } from './data.js';
import { computeWalletRisk } from './risk.js';
import { computeEstimate, findInstrument, type EstimateInput } from './estimate.js';
import { computeLiquidationMap, mapRangeFor, type LiquidationQuery } from './liquidations.js';
import { computeTopTraders, type TradersQuery } from './traders.js';

/**
 * The four intelligence computations and the live markets read, shared by the HTTP routes
 * (paid and preview) and the MCP tools so every surface answers from the same code.
 */

/** The Papertrade wallet stream throttles bursts, so keep concurrency low and bound the whole scan. */
const CONCURRENCY = 3;
const SCAN_BUDGET_MS = 20_000;

/** Run `fn` over `items` with a small concurrency cap, keeping Worker subrequests bounded. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, deadlineMs = Number.POSITIVE_INFINITY): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && Date.now() < deadlineMs) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function parseAddress(raw: string): Address {
  if (!isAddress(raw, { strict: false })) throw new InputError('address must be a 0x-prefixed 40 hex character HyperEVM address', 'address');
  return raw.toLowerCase() as Address;
}

export async function runMarkets(config: ResolvedConfig) {
  const client = makeClient(config.apiUrl);
  const trading = await loadTradingState(client);
  const marks = await loadMarks(client, trading.instruments.filter((i) => i.active && !i.retired));
  const nowMs = Date.now();
  return {
    asOf: new Date(nowMs).toISOString(),
    tradingPaused: trading.tradingPaused,
    markets: trading.instruments
      .filter((i) => marks.has(i.id))
      .map((i) => {
        const m = marks.get(i.id)!;
        return {
          id: i.id,
          symbol: i.symbol,
          markPrice: m.price,
          markAsOf: new Date(m.atMs).toISOString(),
          maxLeverage: i.maxLeverage,
          openable: i.openable,
          closeOnly: i.closeOnly,
          paused: i.paused,
          // OI and caps are base-asset quantities on chain; priced at the mark here.
          longOpenInterestUsd: Number((wad(i.longOiRaw) * m.price).toFixed(2)),
          shortOpenInterestUsd: Number((wad(i.shortOiRaw) * m.price).toFixed(2)),
          longCapUsd: Number((wad(i.longCapRaw) * m.price).toFixed(2)),
          shortCapUsd: Number((wad(i.shortCapRaw) * m.price).toFixed(2)),
        };
      }),
  };
}

export async function runWalletRisk(config: ResolvedConfig, address: Address) {
  const client = makeClient(config.apiUrl);
  const [state, trading] = await Promise.all([loadWallet(address, config.apiUrl), loadTradingState(client)]);
  const marks = await loadMarks(client, trading.instruments.filter((i) => state.positions.some((p) => p.instrumentId === i.id)));
  return computeWalletRisk({ state, instruments: trading.instruments, marks, nowMs: Date.now() });
}

export async function runLiquidationsNearby(config: ResolvedConfig, query: LiquidationQuery) {
  const client = makeClient(config.apiUrl);
  const trading = await loadTradingState(client);
  const instrument = findInstrument(trading, query.market);
  const [mark, board, protocol] = await Promise.all([
    loadMark(client, instrument),
    wrapUpstream('Papertrade leaderboard', () => client.leaderboard({ window: '24h', sortKey: 'currentOpenNotional', sortDir: 'desc', pageSize: query.accounts })),
    wrapUpstream('Papertrade liquidation map', () => client.liquidationMap(instrument.id, mapRangeFor(query.pct))),
  ]);
  const holders = board.accounts.filter((a) => a.currentOpenPositionCount > 0);
  const results = await mapLimit(
    holders,
    CONCURRENCY,
    (a: LeaderboardAccount) => loadWallet(a.address, config.apiUrl, { timeoutMs: 6_000, retries: 0 }).catch(() => null),
    Date.now() + SCAN_BUDGET_MS,
  );
  const wallets = results.filter((w): w is WalletState => w !== undefined && w !== null);
  if (holders.length > 0 && wallets.length === 0) throw new UpstreamError('Could not read any wallet snapshots from Papertrade');
  return computeLiquidationMap({ query, instrument, mark, wallets, protocol, accountsRequested: holders.length, nowMs: Date.now() });
}

export async function runEstimate(config: ResolvedConfig, input: EstimateInput) {
  const client = makeClient(config.apiUrl);
  const trading = await loadTradingState(client);
  const instrument = findInstrument(trading, input.market);
  const [mark, summary] = await Promise.all([loadMark(client, instrument), loadProtocolSummary(client)]);
  return computeEstimate({ input, trading, mark, instrument, summary, nowMs: Date.now() });
}

export async function runTopTraders(config: ResolvedConfig, query: TradersQuery) {
  const client = makeClient(config.apiUrl);
  const board = await wrapUpstream('Papertrade leaderboard', () =>
    client.leaderboard({ window: query.window, sortKey: 'totalWindowedPnl', sortDir: 'desc', pageSize: query.limit }),
  );
  const accounts = board.accounts.slice(0, query.limit);
  const pages = await mapLimit(accounts, CONCURRENCY, (a) => client.accountTrades(a.address).then((p) => p.items as AccountTrade[]).catch(() => null));
  const trades = new Map<string, AccountTrade[] | null>(accounts.map((a, i) => [a.address, pages[i] ?? null]));
  return computeTopTraders({ query, accounts, trades, totalAccounts: board.summary.uniqueAccounts, nowMs: Date.now() });
}

/** Upstream reachability plus payment configuration. `ok` is false when either is broken. */
export async function runHealth(config: ResolvedConfig) {
  const active = activeNetworks(config);
  let upstream: { ok: boolean; indexedThroughBlock?: number; tradingPaused?: boolean; error?: string };
  try {
    const t = await loadTradingState(makeClient(config.apiUrl));
    upstream = { ok: true, indexedThroughBlock: t.indexedThroughBlock, tradingPaused: t.tradingPaused };
  } catch (e) {
    upstream = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return {
    ok: upstream.ok && config.problems.length === 0,
    service: 'papertrade-x402',
    version: VERSION,
    upstream,
    x402: {
      configured: active.length > 0 && config.problems.length === 0,
      facilitator: config.facilitatorUrl,
      networks: config.networks.map((n) => ({ network: n.network, label: n.label, configured: n.configured })),
      problems: config.problems,
    },
    prices: config.prices,
  };
}
