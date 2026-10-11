---
title: Quickstart
description: Make your first free call, see the real 402 challenge, then connect an AI client.
---

# Quickstart

Base URL: `https://papertrade-x402.pages.dev`. Every command below is safe: none of them signs or pays anything.

## 1. Read live markets (free)

```bash
curl -s https://papertrade-x402.pages.dev/api/v1/markets
```

## 2. Try a free preview

```bash
curl -s "https://papertrade-x402.pages.dev/api/v1/preview/liquidations/nearby?market=BTC&pct=0.5"

curl -s -X POST https://papertrade-x402.pages.dev/api/v1/preview/estimate \
  -H 'content-type: application/json' \
  -d '{"market":"BTC","side":"long","marginUsd":100,"leverage":100}'
```

Previews are limited to 60 cost-weighted requests per minute per client and carry `X-RateLimit-*` headers.

## 3. See the 402 challenge

Call a paid route without payment:

```bash
curl -si https://papertrade-x402.pages.dev/api/v1/wallet/0x3f139ef9f371fbbfc299aa65b93534e177141b18/risk
```

When payments are configured you get `HTTP/2 402` and a base64 `PAYMENT-REQUIRED` header. Decode it to read the price, network and payTo:

```bash
curl -si https://papertrade-x402.pages.dev/api/v1/liquidations/nearby \
  | grep -i '^payment-required:' | cut -d' ' -f2 | base64 -d | jq
```

When the operator has not set a payout address yet, the same call returns an explanatory `503` with links to the free tier. That is the honest state of the service, not an error in your request.

## 4. Connect your AI

```bash
claude mcp add --transport http papertrade-x402 https://papertrade-x402.pages.dev/mcp
```

Other clients are in [Connect your AI](/docs/connect-your-ai/). Then ask: "What is the liquidation risk of wallet 0x3f13...1b18 on Papertrade?"

## 5. Pay per call from code

Use the typed client in this repository, or any x402 client. Start with `dryRun: true` to see the price and payTo without signing:

```ts
import { PapertradeX402 } from 'papertrade-x402';

const client = new PapertradeX402({ baseUrl: 'https://papertrade-x402.pages.dev', dryRun: true });
console.log(await client.walletRisk('0x3f139ef9f371fbbfc299aa65b93534e177141b18'));
```

Real payment, with a signer you supply, is covered in [Paying as an agent](/docs/paying-as-an-agent/).
