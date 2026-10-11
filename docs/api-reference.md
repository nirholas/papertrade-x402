---
title: API reference
description: Every route, its parameters, its response shape, and the free preview that mirrors it.
---

# API reference

Base URL `https://papertrade-x402.pages.dev`. All responses are JSON. The machine-readable form is [`/openapi.json`](/openapi.json) (OpenAPI 3.1) and the payment-aware form is [`/.well-known/x402`](/.well-known/x402).

## Errors

| Status | Meaning | Charged |
| --- | --- | --- |
| 400 | Invalid input. Body names the field and the rule. | no |
| 402 | Payment required. `PAYMENT-REQUIRED` header lists accepts. | no |
| 429 | Preview or request rate limit. `Retry-After` is set. | no |
| 502 | Papertrade upstream failed. Retry later. | no |
| 503 | `not_configured`: the operator has not set a payout address, or a configuration value is invalid. | no |

## Free routes

### `GET /api/v1/health`

Upstream reachability, payment configuration and `problems` if any. Answers 503 when payments are not configured, with the same explanatory body as paid routes.

### `GET /api/v1/markets`

Live Papertrade instruments with mark price and open interest.

```bash
curl -s https://papertrade-x402.pages.dev/api/v1/markets
```

## Paid routes

### `GET /api/v1/wallet/{address}/risk` ($0.02)

Open positions of a HyperEVM wallet with bust price, distance to liquidation, a 0 to 100 risk score, effective leverage, unrealized PnL and the net settlement if closed at the live mark.

| Parameter | In | Type | Notes |
| --- | --- | --- | --- |
| `address` | path | string | `^0x[0-9a-fA-F]{40}$` |

Response: `wallet`, `asOf`, `balanceUsd`, `summary` (`openPositions`, `totalNotionalUsd`, `unrealizedPnlUsd`, `accountEffectiveLeverage`, `maxRiskScore`, `nearestBustDistancePct`), `positions[]`.

### `GET /api/v1/liquidations/nearby` ($0.05)

Open positions of the top leaderboard accounts whose bust is within `pct` percent of the mark, aggregated into 20 price buckets, plus protocol-wide totals.

| Parameter | Type | Default | Range |
| --- | --- | --- | --- |
| `market` | string | `BTC` | `BTC`, `ETH` |
| `pct` | number | `0.5` | greater than 0, at most 25 |
| `accounts` | integer | `20` | 1 to 25 |

### `POST /api/v1/estimate` ($0.005)

What a hypothetical position settles for: bust price, limit checks, the close at a chosen exit, PAPER minted on a loss, and a price-move scenario ladder.

| Field | Type | Notes |
| --- | --- | --- |
| `market` | string | `BTC` or `ETH` |
| `side` | string | `long` or `short` |
| `marginUsd` | number | greater than 0 |
| `leverage` | integer | 1 to 1000 |
| `entryPrice` | number | optional, defaults to live mark |
| `exitPrice` or `exitMovePct` | number | optional, absolute exit or signed percent move |

### `GET /api/v1/traders/top` ($0.03)

Top traders by windowed PnL with open exposure and stats derived from recent closed trades: win rate, average and margin-weighted leverage, liquidations, average hold time.

| Parameter | Type | Default | Range |
| --- | --- | --- | --- |
| `window` | string | `7d` | `24h`, `7d`, `30d`, `all` |
| `limit` | integer | `10` | 1 to 25 |

## Free preview routes

Each preview runs the same live computation and withholds detail. They are rate limited to 60 cost-weighted requests per minute per client.

| Route | What it withholds |
| --- | --- |
| `GET /api/v1/preview/wallet/{address}/risk` | per-position bust prices, scores and settlement estimates |
| `GET /api/v1/preview/liquidations/nearby` | price buckets, nearest positions, and scans beyond 5 accounts |
| `POST /api/v1/preview/estimate` | close at an exit, PAPER mint, scenario ladder |
| `GET /api/v1/preview/traders/top` | ranks beyond 3, derived stats, open exposure |

Every preview response carries a `preview` object with `tier: "free-preview"`, the `omitted` list, and the `paid` endpoint id and its price.

## Response headers

`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` on preview routes. Paid responses add `PAYMENT-RESPONSE` after settlement.
