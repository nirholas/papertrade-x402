# papertrade-x402

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-0a8f5b?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://github.com/nirholas/papertrade-x402)
[![HyperEVM](https://img.shields.io/badge/HyperEVM-chain_999-0a8f5b?style=flat-square)](https://papertrade.xyz)
[![GitHub stars](https://img.shields.io/github/stars/nirholas/papertrade-x402?style=flat-square&color=0a8f5b)](https://github.com/nirholas/papertrade-x402/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/nirholas/papertrade-x402?style=flat-square&color=0a8f5b)](https://github.com/nirholas/papertrade-x402/commits/main)
[![MCP](https://img.shields.io/badge/MCP-streamable_http-0a8f5b?style=flat-square)](https://papertrade-x402.pages.dev/docs/mcp/)
[![x402](https://img.shields.io/badge/x402-v2_bazaar-0a8f5b?style=flat-square)](https://papertrade-x402.pages.dev/.well-known/x402)
[![Unofficial](https://img.shields.io/badge/community-unofficial-lightgrey?style=flat-square)](#the-papertrade-toolkit)

[Live site](https://papertrade-x402.pages.dev) · [Docs](https://papertrade-x402.pages.dev/docs/) · [MCP](https://papertrade-x402.pages.dev/mcp) · [llms.txt](https://papertrade-x402.pages.dev/llms.txt) · [Issues](https://github.com/nirholas/papertrade-x402/issues) · [Discussions](https://github.com/nirholas/papertrade-x402/discussions) · [Papertrade](https://papertrade.xyz) · [Toolkit](#the-papertrade-toolkit)

**Unofficial** pay-per-call intelligence API over [Papertrade](https://papertrade.xyz) (the fully on-chain 1000x synthetic perps exchange on Hyperliquid HyperEVM), built for AI agents. Each request is paid in USDC with the [x402](https://x402.org) protocol, on **Solana first** and **Base second**, through the PayAI facilitator. No API keys, no accounts, no subscriptions: an HTTP 402 and a signature.

> Unofficial, not affiliated with Papertrade. High leverage can lose your whole margin. Nothing here is financial advice.

Live: https://papertrade-x402.pages.dev (docs at `/docs/`, MCP at `/mcp`).

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

## Free preview and MCP

Every paid route has a rate limited free preview under `/api/v1/preview/*` that runs the same live computation and withholds detail. Until the operator sets a payout address, paid routes answer an explanatory `503` that links to the free tier.

The read-only MCP server at `https://papertrade-x402.pages.dev/mcp` (Streamable HTTP, stateless, no auth) exposes six free tools and four paid tools. Paid tools return the x402 payment requirements and never pay: an agent pays over HTTP with its own wallet.

```bash
claude mcp add --transport http papertrade-x402 https://papertrade-x402.pages.dev/mcp
codex mcp add papertrade-x402 --url https://papertrade-x402.pages.dev/mcp
npx @modelcontextprotocol/inspector --cli https://papertrade-x402.pages.dev/mcp --transport http --method tools/list
```

Setup for Claude Desktop, claude.ai, ChatGPT, Gemini CLI, Cursor, VS Code, Windsurf, Zed, Cline, Goose, Continue and the Claude and OpenAI APIs is in [docs/connect-your-ai.md](docs/connect-your-ai.md).

Discovery files: `/.well-known/x402`, `/.well-known/mcp/server-card.json`, `/.well-known/agent-card.json`, `/.well-known/api-catalog`, `/openapi.json`, `/llms.txt`, `/llms-full.txt`. Registry manifest: `server.json` (`io.github.nirholas/papertrade-x402`).

## Documentation

Markdown sources are in [`docs/`](docs/) and `npm run build:site` renders them to `/docs/` with search, `.md` twins and `llms-full.txt`. Start with [overview](docs/overview.md), [MCP](docs/mcp.md) and [paying as an agent](docs/paying-as-an-agent.md).

## Enable payments

Paid routes need a payout address you choose. From `site/`, one command, then redeploy:

```bash
npx wrangler pages secret put X402_SOLANA_PAY_TO
```

Details in [docs/self-hosting.md](docs/self-hosting.md).

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

## The Papertrade toolkit

Nine open-source building blocks for [Papertrade](https://papertrade.xyz), the fully on-chain 1000x perps exchange on Hyperliquid HyperEVM. Use them together or on their own.

| Project | What it does |
|---|---|
| [papertrade-ai](https://github.com/nirholas/papertrade-ai) | MCP server and CLI: trade Papertrade from Claude, ChatGPT, Cursor and any MCP client |
| [papertrade-sdk](https://github.com/nirholas/papertrade-sdk) | Typed API client, live account stream, EIP-712 signing and verified settlement math. |
| [papertrade-terminal](https://github.com/nirholas/papertrade-terminal) | Non-custodial web trading terminal with charts, order ticket, funding and swaps. |
| [papertrade-analytics](https://github.com/nirholas/papertrade-analytics) | DefiLlama-style dashboard and JSON API: TVL, volume, OI, PAPER economics. |
| [papertrade-explorer](https://github.com/nirholas/papertrade-explorer) | Linkable wallet pages, decoded transactions and a live leaderboard. |
| [papertrade-liquidations](https://github.com/nirholas/papertrade-liquidations) | Liquidation map and closest-to-bust feed, recomputed with the verified formula. |
| [papertrade-yield](https://github.com/nirholas/papertrade-yield) | PAPER staking dashboard with realized USDC yield and wallet-signed actions. |
| [papertrade-alerts](https://github.com/nirholas/papertrade-alerts) | Know before the liquidation: Telegram, Discord and webhook alerts. |
| [papertrade-copytrade](https://github.com/nirholas/papertrade-copytrade) | Guard-railed copy-trading CLI. Dry run by default. |
| **papertrade-x402** (this repo) | Pay-per-call intelligence API for AI agents, paid in USDC on Solana or Base. |

## Contributing and support

- Found a bug or want a feature? [Open an issue](https://github.com/nirholas/papertrade-x402/issues/new/choose).
- Questions and show-and-tell: [Discussions](https://github.com/nirholas/papertrade-x402/discussions).
- Pull requests are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through [SECURITY.md](SECURITY.md).
- If this saved you time, a star helps other Papertrade traders and builders find it.

Built by [three.ws](https://three.ws).

## Disclaimer

Unofficial, not affiliated with Papertrade. High leverage can lose your whole margin. Apache-2.0 licensed.
