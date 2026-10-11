import { PapertradeClient, fetchWalletState, formatUnits, type Instrument, type TradingState, type WalletState, type ProtocolSummary } from 'papertrade-sdk';
import type { Address } from 'viem';
import { UpstreamError } from './errors.js';
import { VERSION } from './config.js';

const WALLET_SNAPSHOT_TIMEOUT_MS = 8_000;

export const wad = (raw: bigint | string): number => Number(formatUnits(raw, 18));

/** One Papertrade API client per request, identified to the upstream. */
export function makeClient(apiUrl: string): PapertradeClient {
  return new PapertradeClient({ baseUrl: apiUrl, clientBuild: `papertrade-x402/${VERSION}`, retries: 2, timeoutMs: 12_000 });
}

export interface Mark {
  instrumentId: number;
  symbol: string;
  price: number;
  priceRaw: bigint;
  /** Timestamp of the last Papertrade price point, ms. */
  atMs: number;
}

export function wrapUpstream<T>(what: string, run: () => Promise<T>): Promise<T> {
  return run().catch((err: unknown) => {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export function loadTradingState(client: PapertradeClient): Promise<TradingState> {
  return wrapUpstream('Papertrade trading state', () => client.tradingState());
}

export function loadProtocolSummary(client: PapertradeClient): Promise<ProtocolSummary> {
  return wrapUpstream('Papertrade protocol summary', () => client.protocolSummary());
}

/** Latest Papertrade mark (the Hyperliquid BBO mid the protocol settles on) for one instrument. */
export function loadMark(client: PapertradeClient, instrument: Instrument, nowMs = Date.now()): Promise<Mark> {
  return wrapUpstream(`${instrument.symbol} mark price`, async () => {
    const { points } = await client.priceHistory({ instrumentId: instrument.id, lookbackMs: 30_000, nowMs });
    const last = points[points.length - 1];
    if (!last) throw new UpstreamError(`${instrument.symbol} has no recent price points`);
    return {
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      price: last.price,
      priceRaw: BigInt(Math.round(last.price * Number(instrument.priceScale))),
      atMs: last.t,
    };
  });
}

export async function loadMarks(client: PapertradeClient, instruments: Instrument[]): Promise<Map<number, Mark>> {
  const marks = await Promise.all(instruments.map((i) => loadMark(client, i)));
  return new Map(marks.map((m) => [m.instrumentId, m]));
}

export interface WalletReadOptions {
  /** Per-attempt wait for the first stream snapshot, ms. */
  timeoutMs?: number;
  /** Extra attempts after a stalled stream. */
  retries?: number;
}

/** First full snapshot of a wallet from the live stream. The stream occasionally stalls, so single-wallet reads retry once. */
export function loadWallet(address: Address, apiUrl: string, options: WalletReadOptions = {}): Promise<WalletState> {
  const { timeoutMs = WALLET_SNAPSHOT_TIMEOUT_MS, retries = 1 } = options;
  const read = () => fetchWalletState(address, { baseUrl: apiUrl, timeoutMs });
  const attempt = async (left: number): Promise<WalletState> => {
    try {
      return await read();
    } catch (err) {
      if (left <= 0) throw err;
      return attempt(left - 1);
    }
  };
  return wrapUpstream(`Wallet state for ${address}`, () => attempt(retries));
}
