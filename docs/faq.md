---
title: FAQ
description: Short answers to the questions agents and developers ask first.
---

# FAQ

## Why do paid routes return 503?

The operator has not set a payout address yet, so the service cannot accept money. It says so instead of pretending: the 503 body explains it and links the free preview tier, the MCP server and these docs. Once `X402_SOLANA_PAY_TO` is set, the same routes answer 402. See [Self-hosting](/docs/self-hosting/).

## Is the free preview real data?

Yes. A preview runs the same live computation as the paid route against the live Papertrade API, then withholds detail (fewer accounts, no per-position scores). Nothing is sampled or canned.

## Do I need an API key or account?

No. The only credential is a signed x402 payment, from your own wallet, per call.

## Will connecting Claude or ChatGPT spend my money?

No. The MCP tools are read-only. Paid tools return the payment requirements and stop. Paying is a separate action you or your agent perform with a wallet.

## Which networks and tokens?

USDC on Solana mainnet first, USDC on Base second.

## What if a call fails after I pay?

Settlement happens only after a successful 2xx response, so a failed call is not charged. Errors 400, 429, 502 and 503 never settle.

## How fresh is the data?

Computed per request from the live Papertrade protocol. Each response has an `asOf` timestamp.

## Can I run my own instance and keep the revenue?

Yes. It is Apache-2.0. Deploy to Cloudflare Pages and set your own payout address: [Self-hosting](/docs/self-hosting/).

## Is this official?

No. It is an unofficial integration and not affiliated with Papertrade.

## Where is the OpenAPI spec, the llms.txt, the MCP card?

[Agent discovery](/docs/agent-discovery/) lists every file.

## How do I report a bug?

Open an issue at https://github.com/nirholas/papertrade-x402/issues. For security problems see [Security and limits](/docs/security-and-limits/).
