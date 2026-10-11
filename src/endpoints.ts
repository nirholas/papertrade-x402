import type { EndpointId } from './config.js';
import recorded from './examples.json';

type Schema = Record<string, unknown>;

export interface PaidEndpoint {
  id: EndpointId;
  method: 'GET' | 'POST';
  /** OpenAPI-style path template. */
  path: string;
  /** Route pattern understood by the x402 resource server. */
  routePattern: string;
  summary: string;
  description: string;
  tags: string[];
  /** Query and path parameters as a JSON Schema object (GET). */
  inputSchema: Schema;
  /** A request that is valid on any day, shown in docs and in the bazaar listing. */
  inputExample: Record<string, unknown>;
  /** Example URL path or body used by curl docs. */
  curlExample: string;
  bodyType?: 'json';
  outputSchema: Schema;
  /** A real response computed from a recorded live Papertrade snapshot, arrays shortened. */
  outputExample: Record<string, unknown>;
}

const num = { type: 'number' };
const str = { type: 'string' };

const examples = recorded.examples as Record<EndpointId, Record<string, unknown>>;

export const PAID_ENDPOINTS: PaidEndpoint[] = [
  {
    id: 'wallet-risk',
    outputExample: examples['wallet-risk'],
    method: 'GET',
    path: '/api/v1/wallet/{address}/risk',
    routePattern: 'GET /api/v1/wallet/:address/risk',
    summary: 'Wallet liquidation risk',
    description:
      'Open Papertrade positions of a wallet with bust price, distance to liquidation, a 0-100 liquidation-risk score, effective leverage, unrealized PnL and the net settlement if closed at the live mark.',
    tags: ['risk', 'positions', 'papertrade'],
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'HyperEVM wallet address of the Papertrade trader' } },
      required: ['address'],
    },
    inputExample: { address: '0x3f139ef9f371fbbfc299aa65b93534e177141b18' },
    curlExample: '/api/v1/wallet/0x3f139ef9f371fbbfc299aa65b93534e177141b18/risk',
    outputSchema: {
      type: 'object',
      properties: {
        wallet: str,
        asOf: str,
        balanceUsd: num,
        summary: { type: 'object', properties: { openPositions: num, totalNotionalUsd: num, unrealizedPnlUsd: num, accountEffectiveLeverage: num, maxRiskScore: num, nearestBustDistancePct: num } },
        positions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { positionId: str, market: str, side: str, leverage: num, entryPrice: num, markPrice: num, bustPrice: num, bustDistancePct: num, riskScore: num, riskBand: str, effectiveLeverage: num, unrealizedPnlUsd: num, estimatedCloseNetUsd: num },
          },
        },
      },
    },
  },
  {
    id: 'liquidations-nearby',
    outputExample: examples['liquidations-nearby'],
    method: 'GET',
    path: '/api/v1/liquidations/nearby',
    routePattern: 'GET /api/v1/liquidations/nearby',
    summary: 'Nearby liquidations map',
    description:
      'Open positions of the top leaderboard accounts whose bust price is within pct percent of the live mark, aggregated into 20 price buckets (a liquidation map), plus protocol-wide totals for the same window.',
    tags: ['liquidations', 'market-data', 'papertrade'],
    inputSchema: {
      type: 'object',
      properties: {
        market: { type: 'string', enum: ['BTC', 'ETH'], default: 'BTC' },
        pct: { type: 'number', exclusiveMinimum: 0, maximum: 25, default: 0.5, description: 'Window around mark, in percent' },
        accounts: { type: 'integer', minimum: 1, maximum: 25, default: 20, description: 'Leaderboard accounts to scan' },
      },
    },
    inputExample: { market: 'BTC', pct: 0.5 },
    curlExample: '/api/v1/liquidations/nearby?market=BTC&pct=0.5',
    outputSchema: {
      type: 'object',
      properties: {
        market: str,
        markPrice: num,
        window: { type: 'object', properties: { pct: num, low: num, high: num } },
        totals: { type: 'object' },
        buckets: { type: 'array', items: { type: 'object', properties: { from: num, to: num, longNotionalUsd: num, shortNotionalUsd: num, longCount: num, shortCount: num } } },
        nearest: { type: 'array', items: { type: 'object' } },
        protocolWide: { type: 'object' },
      },
    },
  },
  {
    id: 'estimate',
    outputExample: examples['estimate'],
    method: 'POST',
    path: '/api/v1/estimate',
    routePattern: 'POST /api/v1/estimate',
    summary: 'Settlement estimate for a hypothetical trade',
    description:
      'Estimate what a hypothetical Papertrade position settles for: bust price, limit checks, the close at a chosen exit (deadband, impact, 2% win fee), PAPER minted on a loss, and a ladder of price-move scenarios.',
    tags: ['estimate', 'settlement', 'papertrade'],
    bodyType: 'json',
    inputSchema: {
      type: 'object',
      properties: {
        market: { type: 'string', enum: ['BTC', 'ETH'] },
        side: { type: 'string', enum: ['long', 'short'] },
        marginUsd: { type: 'number', exclusiveMinimum: 0 },
        leverage: { type: 'integer', minimum: 1, maximum: 1000 },
        entryPrice: { type: 'number', description: 'Defaults to the live mark' },
        exitPrice: { type: 'number', description: 'Absolute exit price (or use exitMovePct)' },
        exitMovePct: { type: 'number', description: 'Signed percent move from entry (or use exitPrice)' },
      },
      required: ['market', 'side', 'marginUsd', 'leverage'],
    },
    inputExample: { market: 'BTC', side: 'long', marginUsd: 100, leverage: 100, exitMovePct: -0.5 },
    curlExample: '/api/v1/estimate',
    outputSchema: {
      type: 'object',
      properties: {
        market: str,
        notionalUsd: num,
        entryPrice: num,
        bustPrice: num,
        wouldBeAccepted: { type: 'boolean' },
        openIssues: { type: 'array', items: str },
        close: { type: 'object', properties: { exitPrice: num, outcome: str, netPnlUsd: num, winFeeUsd: num, paperMinted: num } },
        scenarios: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    id: 'traders-top',
    outputExample: examples['traders-top'],
    method: 'GET',
    path: '/api/v1/traders/top',
    routePattern: 'GET /api/v1/traders/top',
    summary: 'Top traders with derived stats',
    description:
      'Top Papertrade traders by windowed PnL with open exposure and stats derived from their recent closed trades: win rate, average and margin-weighted leverage, liquidations and average hold time.',
    tags: ['leaderboard', 'traders', 'papertrade'],
    inputSchema: {
      type: 'object',
      properties: {
        window: { type: 'string', enum: ['24h', '7d', '30d', 'all'], default: '7d' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
    },
    inputExample: { window: '7d' },
    curlExample: '/api/v1/traders/top?window=7d',
    outputSchema: {
      type: 'object',
      properties: {
        window: str,
        traders: {
          type: 'array',
          items: {
            type: 'object',
            properties: { rank: num, wallet: str, windowedPnlUsd: num, volumeUsd: num, open: { type: 'object' }, stats: { type: 'object', properties: { winRatePct: num, avgLeverage: num, marginWeightedLeverage: num, liquidations: num, closedTrades: num } } },
          },
        },
      },
    },
  },
];

export const endpointById = (id: EndpointId) => PAID_ENDPOINTS.find((e) => e.id === id)!;
