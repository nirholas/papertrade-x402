---
title: Overview
description: What papertrade-x402 is, what it sells, and how an agent or a person uses it.
---

# Overview

papertrade-x402 is an unofficial, pay-per-call intelligence API over [Papertrade](https://papertrade.xyz), the on-chain 1000x synthetic perpetuals exchange on Hyperliquid HyperEVM. It answers four questions an agent or a trader keeps asking, and it charges per request in USDC with the [x402](https://x402.org) protocol. There are no API keys and no accounts. Solana is the first payment rail, Base is the second.

> Unofficial integration. Not affiliated with, endorsed by or operated by Papertrade. High leverage can lose your entire margin. Nothing here is financial advice.

## What you can ask

| Endpoint | Question it answers | Default price |
| --- | --- | --- |
| `GET /api/v1/wallet/{address}/risk` | How close is each open position of this wallet to liquidation? | $0.02 |
| `GET /api/v1/liquidations/nearby` | Where are the liquidations stacked around the live mark? | $0.05 |
| `POST /api/v1/estimate` | What would this hypothetical position settle for? | $0.005 |
| `GET /api/v1/traders/top` | Who is winning, and how do they trade? | $0.03 |

Prices are operator settings, so the live values in `/.well-known/x402` are the source of truth.

## Three ways in

1. **Free preview tier.** Every paid endpoint has a rate limited free preview under `/api/v1/preview/*` that runs the same live computation and withholds the detail that makes the paid answer worth paying for. See [API reference](/docs/api-reference/).
2. **MCP server.** Connect Claude, Codex, ChatGPT, Gemini, Cursor and others to `https://papertrade-x402.pages.dev/mcp`. Free tools return data directly. Paid tools return the exact x402 payment requirements and never pay. See [MCP](/docs/mcp/) and [Connect your AI](/docs/connect-your-ai/).
3. **Pay and call.** An agent that holds its own wallet calls a paid route, receives HTTP 402 with a `PAYMENT-REQUIRED` header, signs one option and retries. See [Paying as an agent](/docs/paying-as-an-agent/).

## Current deployment status

The operator has to set a payout address before paid routes can accept money. Until then paid routes answer an explanatory `503 not_configured` that links to the free tier, and `accepts` in the discovery document is empty. Nothing is invented: the service never fabricates a payTo. Check `status` in `/.well-known/x402` (`accepting_payments` or `payments_not_configured`) or call the `get_service_status` MCP tool.

## Where the data comes from

Every answer is computed live from the Papertrade protocol through the `papertrade-sdk` read layer and the public exchange API at `https://exchange.papertrade.xyz`. Formulas (bust price, close settlement) come from the SDK, not from a reimplementation. Responses are never cached long enough to be stale and never filled with sample data.

## Next

[Quickstart](/docs/quickstart/), then [Concepts](/docs/concepts/) for the Papertrade rules that shape every number.
