import { estimateClose, estimatePaperMinted, notionalToQuantityRaw, liquidationPriceRaw, paperMintRate, formatUnits, usdToWad, type Instrument, type ProtocolSummary, type TradingState } from 'papertrade-sdk';
import { InputError } from './errors.js';
import { wad, type Mark } from './data.js';

export interface EstimateInput {
  market: string;
  side: 'long' | 'short';
  marginUsd: number;
  leverage: number;
  /** Defaults to the live mark. */
  entryPrice?: number;
  /** Absolute exit price. Mutually exclusive with exitMovePct. */
  exitPrice?: number;
  /** Signed percent move from entry (for example -0.5). */
  exitMovePct?: number;
}

const SCENARIO_MOVES_PCT = [-5, -2, -1, -0.5, -0.1, 0.1, 0.5, 1, 2, 5];
const round = (n: number, dp: number) => Number(n.toFixed(dp));

function finite(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new InputError(`${field} must be a finite number`, field);
  return v;
}

/** Parse and bound-check a JSON body. Pure, so the caller can reject it before asking for payment. */
export function parseEstimateInput(body: unknown): EstimateInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InputError('Body must be a JSON object');
  const b = body as Record<string, unknown>;
  const allowed = new Set(['market', 'side', 'marginUsd', 'leverage', 'entryPrice', 'exitPrice', 'exitMovePct']);
  for (const k of Object.keys(b)) if (!allowed.has(k)) throw new InputError(`Unknown field "${k}"`, k);
  if (typeof b.market !== 'string' || !/^[A-Za-z]{2,12}$/.test(b.market)) throw new InputError('market must be a symbol such as BTC or ETH', 'market');
  if (b.side !== 'long' && b.side !== 'short') throw new InputError('side must be "long" or "short"', 'side');
  const marginUsd = finite(b.marginUsd, 'marginUsd');
  if (marginUsd <= 0 || marginUsd > 1e9) throw new InputError('marginUsd must be between 0 and 1,000,000,000', 'marginUsd');
  const leverage = finite(b.leverage, 'leverage');
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 1000) throw new InputError('leverage must be a whole number from 1 to 1000', 'leverage');
  const input: EstimateInput = { market: b.market.toUpperCase(), side: b.side, marginUsd, leverage };
  if (b.entryPrice !== undefined) {
    input.entryPrice = finite(b.entryPrice, 'entryPrice');
    if (input.entryPrice <= 0) throw new InputError('entryPrice must be positive', 'entryPrice');
  }
  if (b.exitPrice !== undefined && b.exitMovePct !== undefined) throw new InputError('Send exitPrice or exitMovePct, not both', 'exitPrice');
  if (b.exitPrice !== undefined) {
    input.exitPrice = finite(b.exitPrice, 'exitPrice');
    if (input.exitPrice <= 0) throw new InputError('exitPrice must be positive', 'exitPrice');
  }
  if (b.exitMovePct !== undefined) {
    input.exitMovePct = finite(b.exitMovePct, 'exitMovePct');
    if (input.exitMovePct <= -100 || input.exitMovePct > 1000) throw new InputError('exitMovePct must be between -100 and 1000', 'exitMovePct');
  }
  return input;
}

/** Plain-language list of the limits this trade would break on Papertrade right now. Empty when it would be accepted. */
export function openIssues(trading: TradingState, instrument: Instrument, input: EstimateInput, markRaw: bigint): string[] {
  const issues: string[] = [];
  const margin = usdToWad(round(input.marginUsd, 6));
  const notional = margin * BigInt(input.leverage);
  if (trading.tradingPaused) issues.push('Trading is paused protocol-wide.');
  if (!instrument.openable) issues.push(`${instrument.symbol} is not accepting new positions.`);
  if (!trading.intake.actions.openPosition) issues.push('The relayer is not accepting new positions right now.');
  if (input.leverage > instrument.maxLeverage) issues.push(`Maximum leverage on ${instrument.symbol} is ${instrument.maxLeverage}x.`);
  if (margin < trading.minimumTradeSizeRaw) issues.push(`Minimum margin is $${formatUnits(trading.minimumTradeSizeRaw, 18)}.`);
  if (notional < trading.minimumOpenNotionalRaw) issues.push(`Minimum position value (margin x leverage) is $${formatUnits(trading.minimumOpenNotionalRaw, 18)}.`);
  if (notional > instrument.maxPositionNotionalRaw) issues.push(`Maximum position value is $${formatUnits(instrument.maxPositionNotionalRaw, 18)}.`);
  const oi = input.side === 'long' ? instrument.longOiRaw : instrument.shortOiRaw;
  const cap = input.side === 'long' ? instrument.longCapRaw : instrument.shortCapRaw;
  // OI and caps are base-asset quantities, so the notional is converted at the mark.
  if (markRaw > 0n && oi + notionalToQuantityRaw(notional, markRaw, instrument.priceScale) > cap) issues.push(`${instrument.symbol} ${input.side} open interest cap would be exceeded.`);
  return issues;
}

export function findInstrument(trading: TradingState, symbol: string): Instrument {
  const found = trading.instruments.find((i) => i.symbol.toUpperCase() === symbol.toUpperCase());
  if (!found) throw new InputError(`Unknown market "${symbol}". Available: ${trading.instruments.map((i) => i.symbol).join(', ')}`, 'market');
  return found;
}

export function computeEstimate(params: { input: EstimateInput; trading: TradingState; mark: Mark; instrument: Instrument; summary: ProtocolSummary; nowMs: number }) {
  const { input, trading, mark, instrument, summary, nowMs } = params;
  const scale = Number(instrument.priceScale);
  const isLong = input.side === 'long';
  const entryPrice = input.entryPrice ?? mark.price;
  const entryRaw = BigInt(Math.round(entryPrice * scale));
  const marginRaw = usdToWad(round(input.marginUsd, 6));
  const notionalUsd = input.marginUsd * input.leverage;
  const bustRaw = liquidationPriceRaw({ entryPriceRaw: entryRaw, leverage: input.leverage, isLong, bustBufferRaw: instrument.bustBufferRaw });
  const bustPrice = Number(bustRaw) / scale;

  const issues = openIssues(trading, instrument, input, BigInt(Math.round(mark.price * scale)));

  const paperState = { trackedLpUsd: wad(summary.paper.trackedLp), tailProgressUsd: wad(summary.paper.tailProgress) };
  const mintRate = paperMintRate(paperState);

  const settle = (exitRaw: bigint) => {
    const c = estimateClose({ instrument, isLong, entryPriceRaw: entryRaw, exitPriceRaw: exitRaw, marginRaw, leverage: input.leverage });
    const outcome = c.liquidated ? 'liquidated' : c.rawPnlUsd < 0 ? 'loss' : c.netPnlUsd > 0 ? 'win' : 'flat';
    return {
      exitPrice: Number(exitRaw) / scale,
      outcome,
      rawPnlUsd: round(c.rawPnlUsd, 2),
      adjustedPnlUsd: round(c.adjustedPnlUsd, 2),
      winFeeUsd: round(c.winFeeUsd, 2),
      netPnlUsd: round(c.netPnlUsd, 2),
      keptFractionOfRawGain: outcome === 'win' ? round(c.keptFraction, 4) : null,
      paperMintBasisUsd: round(c.paperMintBasisUsd, 2),
      paperMinted: round(estimatePaperMinted(c.paperMintBasisUsd, paperState), 2),
    };
  };

  let close: ReturnType<typeof settle> | null = null;
  if (input.exitPrice !== undefined) close = settle(BigInt(Math.round(input.exitPrice * scale)));
  else if (input.exitMovePct !== undefined) close = settle(BigInt(Math.round(entryPrice * (1 + input.exitMovePct / 100) * scale)));

  const scenarios = SCENARIO_MOVES_PCT.map((movePct) => ({
    movePct,
    ...settle(BigInt(Math.round(entryPrice * (1 + movePct / 100) * scale))),
  }));

  return {
    asOf: new Date(nowMs).toISOString(),
    market: instrument.symbol,
    side: input.side,
    leverage: input.leverage,
    marginUsd: input.marginUsd,
    notionalUsd: round(notionalUsd, 2),
    entryPrice,
    entryPriceSource: input.entryPrice === undefined ? 'live-mark' : 'request',
    markPrice: mark.price,
    bustPrice,
    bustDistanceFromEntryPct: round((Math.abs(entryPrice - bustPrice) / entryPrice) * 100, 4),
    wouldBeAccepted: issues.length === 0,
    openIssues: issues,
    paper: { mintRatePerUsdOfLossBasis: round(mintRate, 4), trackedLpUsd: round(paperState.trackedLpUsd, 2), tailProgressUsd: round(paperState.tailProgressUsd, 2) },
    close,
    scenarios,
    method:
      'Bust price is the protocol two-step formula with the instrument bust buffer. Wins apply the entry/50000 deadband, asymmetric impact and the 2% win fee; losses pay the raw loss; crossing bust forfeits the margin. A loss mints PAPER on 98% of the loss (liquidation: 100% of margin) at the live mint rate.',
  };
}
