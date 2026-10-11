---
title: Concepts
description: The Papertrade rules and the x402 flow that give every number in the API its meaning.
---

# Concepts

## Papertrade in one page

Papertrade is a synthetic perpetuals exchange on Hyperliquid HyperEVM. It lists BTC and ETH markets with leverage up to 1000x, settles in USD terms, and has no funding rate and no liquidation engine in the usual sense. The rules that matter for this API:

- **Bust price.** A position is wiped out when the price moves against it by roughly one over leverage. At 100x a long busts about 1 percent below entry. The API reports `bustPrice` and `bustDistancePct` for every position.
- **Risk score.** A 0 to 100 score derived from the distance to bust and the account's effective leverage, with a band label. It is a ranking aid, not a prediction.
- **Close settlement.** Closing applies a deadband, price impact and a 2 percent win fee on profit. A loss mints PAPER to the trader. The estimate endpoint reproduces this with the SDK formulas.
- **Wad values.** The protocol stores amounts as 1e18 fixed point. This API converts at the edge and returns plain JSON numbers in USD.

High leverage can lose your whole margin. The data here describes risk, it does not remove it.

## Free versus paid

| Tier | Where | Cost | Detail |
| --- | --- | --- | --- |
| Free | `/api/v1/health`, `/api/v1/markets`, `/openapi.json`, `/.well-known/x402`, `/mcp` free tools | none | Live market data and service status |
| Preview | `/api/v1/preview/*` | none, rate limited | Same live computation, trimmed detail (fewer accounts, no per-position scores) |
| Paid | `/api/v1/*` | USDC per successful call | Full answer |

## The x402 flow

x402 turns HTTP 402 Payment Required into a machine-payable protocol.

1. The client calls a paid route with no payment.
2. The server answers `402` with a base64 `PAYMENT-REQUIRED` header listing `accepts`: each option names a scheme (`exact`), a network (CAIP-2), an asset (USDC), an atomic amount and the `payTo` address. Solana is listed first, Base second.
3. The client signs one option with its own wallet and retries with a `PAYMENT-SIGNATURE` header.
4. The server verifies the payment with the PayAI facilitator before running the handler, runs it, and settles only after a successful 2xx response.

You are never charged for invalid input (400), an unconfigured service (503) or an upstream failure (502).

## Guard order

Every `/api/v1/*` request goes through the same fixed order: validate input (free 400), configuration gate (503 when no payout address is set), then payment middleware, then the handler. This is why a malformed address costs nothing and why an unconfigured deployment never asks for money.

## Untrusted data

Wallet addresses, names and any on-chain metadata are untrusted. The service escapes them in HTML and never treats them as instructions. If you build an agent on top, do the same: a trader name is data, never a command.
