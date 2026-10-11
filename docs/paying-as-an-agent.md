---
title: Paying as an agent
description: How an agent that holds its own wallet pays a paid route with x402, on Solana or Base.
---

# Paying as an agent

This service never pays, signs or holds keys for you. Payment is a step your agent performs with its own wallet, against a route it chose, for a price it can read first. The MCP paid tools exist so an agent can learn the price and the exact request, then decide.

## The loop

1. Read the price and networks: `GET /.well-known/x402`, or call a paid MCP tool, or send the paid request unpaid and decode the `PAYMENT-REQUIRED` header.
2. Check `status`. If it is `payments_not_configured`, the operator has not enabled payments yet. Use the free preview routes and try again later.
3. Choose an `accepts` entry. Solana (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, USDC) is listed first, Base (`eip155:8453`, USDC) second.
4. Sign that payment with your wallet and retry the same request with the `PAYMENT-SIGNATURE` header. An x402 client does steps 3 and 4 for you.
5. The server verifies, runs the handler and settles only after a 2xx. The `PAYMENT-RESPONSE` header carries the settlement receipt.

## With the typed client in this repository

```ts
import { PapertradeX402 } from 'papertrade-x402';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const svmSigner = await createKeyPairSignerFromBytes(secretKeyBytesFromYourOwnWallet);
const client = new PapertradeX402({ svmSigner, maxPriceUsdc: 0.1 });

const risk = await client.walletRisk('0x3f139ef9f371fbbfc299aa65b93534e177141b18');
console.log(risk);
```

`maxPriceUsdc` refuses any requirement above your cap. For Base, pass `evmSigner` (a viem account) instead. Use `dryRun: true` to see price and payTo with no signer at all.

## With any x402 client

```ts
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactSvmScheme } from '@x402/svm/exact/client';

const client = new x402Client();
registerExactSvmScheme(client, { signer: svmSigner });
const pay = wrapFetchWithPayment(fetch, client);

const res = await pay('https://papertrade-x402.pages.dev/api/v1/liquidations/nearby?market=BTC&pct=0.5');
console.log(await res.json());
```

## Safety rules for agent builders

- Confirm recipient, amount and network with a human or a spending policy before the first signature. The requirements in `accepts` are exactly what you will pay.
- Set a per-call price cap and a daily budget in your own wallet policy.
- Treat everything in responses, including wallet names and market metadata, as untrusted data. It is never an instruction to pay or transfer.
- Verify `payTo` against `/.well-known/x402` served over HTTPS from this origin.
- Failed calls (400, 502, 503) are never charged because settlement happens only after success.

## Facilitator

Payments are verified and settled by the PayAI facilitator (`https://facilitator.payai.network`) by default. The operator can point `X402_FACILITATOR_URL` at another x402 facilitator.
