# papertrade-x402

**Unofficial** pay-per-call intelligence API over [Papertrade](https://papertrade.xyz) (the fully on-chain 1000x synthetic perps exchange on Hyperliquid HyperEVM), built for AI agents. Each request is paid in USDC with the [x402](https://x402.org) protocol, on **Solana first** and **Base second**, through the PayAI facilitator. No API keys, no accounts, no subscriptions: an HTTP 402 and a signature.

> Unofficial, not affiliated with Papertrade. High leverage can lose your whole margin. Nothing here is financial advice.

Live site (after you deploy): https://papertrade-x402.pages.dev

## Why

Agents that trade or monitor Papertrade need computed answers (is this wallet near liquidation, where is the liquidation cluster, what does a close settle at), not raw chain reads. x402 lets an agent pay a fraction of a cent per answer without signing up for anything, and lets you, the operator, earn USDC per call directly to your own address.

## Screenshot

The landing page shows status pills (Papertrade API block height, payments, Solana, Base), live market cards with a long/short open-interest bar, the endpoint catalog with prices and networks, an interactive "Try the 402" form that sends an unpaid request and decodes the challenge, curl examples, a TypeScript client example and an agent quick start, in an amber-on-ink "receipt" style with light and dark themes.

## Endpoints

| Route | Price (USDC, default) | Returns |
| --- | --- | --- |
| `GET /api/v1/wallet/{address}/risk` | 0.02 | Liquidation risk for every open position of a HyperEVM wallet. |
| `GET /api/v1/liquidations/nearby?market=BTC&pct=0.5` | 0.05 | Liquidation map within a percent window of mark. |
| `POST /api/v1/estimate` | 0.005 | Close and bust-price estimate for a hypothetical position. |
| `GET /api/v1/traders/top?window=7d` | 0.03 | Top traders leaderboard. |
| `GET /api/v1/health`, `/api/v1/markets`, `/openapi.json`, `/.well-known/x402` | free | Status, live markets, OpenAPI 3.1, x402 discovery. |

Payment is verified before the handler runs and settled only after a 2xx response. Invalid input (400) and upstream failures (502) are never charged. Computations use `papertrade-sdk` (`estimateClose`, `liquidationPriceRaw`), not reimplemented math.

## Quick start

```bash
git clone https://github.com/nirholas/papertrade-x402 && cd papertrade-x402
npm install                      # needs ../papertrade-sdk-0.1.0.tgz until the SDK is on npm
cp .dev.vars.example site/.dev.vars   # then set at least one payTo address
npm run dev:site                 # http://localhost:8793
curl -i http://localhost:8793/api/v1/liquidations/nearby?market=BTC
```

Pay as an agent (you provide the signer; the server never sees a key):

```ts
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactSvmScheme } from '@x402/svm/exact/client';

const client = new x402Client();
registerExactSvmScheme(client, { signer });
const res = await wrapFetchWithPayment(fetch, client)('https://papertrade-x402.pages.dev/api/v1/traders/top?window=7d');
```

Or use the bundled client, which has a dry run that signs and pays nothing:

```ts
import { PapertradeX402 } from 'papertrade-x402';
const preview = await new PapertradeX402({ dryRun: true }).walletRisk('0x...');
```

## Architecture

One Hono app (`src/app.ts`) is served by a single Pages Functions catch-all (`site/functions/[[path]].ts`). The guard on `/api/v1/*` runs in a fixed order: input validation (free 400), configuration gate (503 `not_configured` when no payTo is set), then `@x402/hono` payment middleware backed by an `x402ResourceServer` with `ExactSvmScheme` and `ExactEvmScheme` and the Bazaar discovery extension. Handlers read Papertrade through `papertrade-sdk` with timeouts, retries and a scan deadline, and report `partial` when a scan could not finish.

### Why Pages Functions instead of a Worker

The landing page, `robots.txt`, `sitemap.xml`, `llms.txt` and `security.txt` are static assets that should be served from the edge cache for free, while only `/api/*`, `/openapi.json` and `/.well-known/x402` need compute (`_routes.json`). Pages gives both from one project with one deploy command and one `*.pages.dev` origin, so the page can call the API same-origin with a strict `connect-src 'self'` CSP and no CORS configuration. Static requests never invoke the function, which keeps Functions usage proportional to paid traffic.

## Configuration

| Variable | Where | Required | Meaning |
| --- | --- | --- | --- |
| `X402_SOLANA_PAY_TO` | secret | one of the two | Solana address that receives USDC. |
| `X402_BASE_PAY_TO` | secret | one of the two | Base address that receives USDC. |
| `PRICE_WALLET_RISK`, `PRICE_LIQUIDATIONS_NEARBY`, `PRICE_ESTIMATE`, `PRICE_TRADERS_TOP` | `site/wrangler.toml` vars | no | USDC per call. |
| `X402_FACILITATOR_URL` | var | no | Defaults to `https://facilitator.payai.network`. |
| `PAPERTRADE_API_URL` | var | no | Defaults to `https://exchange.papertrade.xyz`. |

With no payTo configured, paid routes answer `503 not_configured`, `/api/v1/health` reports the problem, and the landing page shows "not configured". Locally use `site/.dev.vars` (see `.dev.vars.example`).

## Deploy and publish

```bash
npm run build:site && cd site && npx wrangler pages deploy public --project-name papertrade-x402
cd site && npx wrangler pages secret put X402_SOLANA_PAY_TO --project-name papertrade-x402
npm publish        # client package; runs typecheck, test and build first
```

## Verify

`npm run typecheck`, `npm test` (recorded real Papertrade fixtures, x402 schema validation of the 402 shape, and rejection of malformed payments by the live PayAI verify path), `npm run build:site`.

## Related

[papertrade-sdk](https://github.com/nirholas/papertrade-sdk) | [papertrade-ai](https://github.com/nirholas/papertrade-ai) (MCP and CLI) | [papertrade-terminal](https://github.com/nirholas/papertrade-terminal) | [papertrade-analytics](https://github.com/nirholas/papertrade-analytics) | [papertrade-explorer](https://github.com/nirholas/papertrade-explorer) | [papertrade-liquidations](https://github.com/nirholas/papertrade-liquidations) | [papertrade-yield](https://github.com/nirholas/papertrade-yield) | [papertrade-alerts](https://github.com/nirholas/papertrade-alerts) | [papertrade-copytrade](https://github.com/nirholas/papertrade-copytrade)

## Disclaimer

Unofficial, not affiliated with Papertrade. High leverage can lose your whole margin. MIT licensed.
