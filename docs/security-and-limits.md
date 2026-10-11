---
title: Security and limits
description: What the service can and cannot do with money, how it limits abuse, and how to report a problem.
---

# Security and limits

## Money safety

- The server never holds a private key and never signs, sends, swaps, bridges or mints anything. The only value that moves is the USDC payment you sign yourself, to the `payTo` shown in `accepts`.
- The MCP server is read-only. Paid tools return requirements, not payments.
- Settlement happens only after a successful 2xx. Invalid input, an unconfigured service or an upstream failure is never charged.
- Payout addresses come from the environment only. No address is hardcoded in the repository or invented when missing.

## Untrusted data

Wallet addresses, trader names and any on-chain metadata are data. The landing page sets them with `textContent`, the API escapes them, and agents must not interpret them as instructions.

## Rate limits

| Surface | Limit | Scope |
| --- | --- | --- |
| `/api/v1/preview/*` | 60 cost-weighted requests per minute | per client IP, per isolate |
| `/mcp` requests | 120 per minute | per client IP, per isolate |
| `/mcp` tool calls | 40 cost-weighted per minute | per client IP, per isolate |
| `/mcp` request body | 64 KB | per request |
| Batch size | 20 messages | per request |

Limits use in-memory counters inside each Cloudflare isolate, so they bound abuse but are not a global quota. Upstream Papertrade calls are capped in concurrency, with timeouts and bounded retries, so a burst cannot fan out without limit. Paid routes are limited by payment itself.

## Browser protections

The site sends a strict Content-Security-Policy (`script-src 'self'; style-src 'self'`), `nosniff`, a strict referrer policy and a locked permissions policy. Only the landing page may be framed, and only by `https://papertrade-os.pages.dev` and `*.pages.dev`.

## Not financial advice

Papertrade is a 1000x synthetic perpetuals exchange. High leverage can lose your entire margin. Risk scores, bust prices and estimates describe the protocol rules at a moment in time, they are not predictions or advice. This is an unofficial integration, not affiliated with Papertrade.

## Reporting a vulnerability

See [SECURITY.md](https://github.com/nirholas/papertrade-x402/blob/main/SECURITY.md) in the repository and `/.well-known/security.txt`. Please do not open public issues for exploitable bugs.
