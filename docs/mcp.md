---
title: MCP server
description: The Model Context Protocol endpoint, its ten tools with schemas, and example calls.
---

# MCP server

Endpoint: `https://papertrade-x402.pages.dev/mcp`

It speaks MCP Streamable HTTP in stateless mode: `POST /mcp` with JSON-RPC 2.0 (single messages or batches of up to 20), no sessions, no cookies, no authentication. Responses are `application/json`, or a single SSE `message` event when the client accepts only `text/event-stream`. `GET /mcp` with `Accept: text/event-stream` answers 405 with `Allow: POST`; a plain `GET` returns a JSON description of the server. `DELETE` answers 405. CORS allows any origin, and the server never trusts `Origin` for anything.

Supported protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05`. The server echoes the client's version when supported and otherwise answers `2025-06-18`.

## Read-only by design

No tool signs, sends, pays or places an order. The four paid tools return the x402 payment requirements for the matching HTTP route and nothing else. To actually pay, an agent with its own wallet calls the HTTP route (see [Paying as an agent](/docs/paying-as-an-agent/)). Every tool carries `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`.

## Tools

| Tool | Tier | What it does |
| --- | --- | --- |
| `get_markets` | free | Live instruments, mark prices, open interest |
| `get_service_status` | free | Upstream health, payment status, prices, accepted networks |
| `preview_wallet_risk` | free | Account-level risk summary for a wallet |
| `preview_liquidations_nearby` | free | Liquidation totals around mark, scanning up to 5 accounts |
| `preview_estimate_position` | free | Bust price and limit checks for a hypothetical position |
| `preview_top_traders` | free | Top 3 traders by windowed PnL |
| `wallet_risk` | paid | x402 requirements for `GET /api/v1/wallet/{address}/risk` |
| `liquidations_nearby` | paid | x402 requirements for `GET /api/v1/liquidations/nearby` |
| `estimate_position` | paid | x402 requirements for `POST /api/v1/estimate` |
| `top_traders` | paid | x402 requirements for `GET /api/v1/traders/top` |

Input schemas mirror the HTTP parameters in the [API reference](/docs/api-reference/): `address` (0x plus 40 hex), `market` (`BTC` or `ETH`), `pct` (0 to 25), `accounts` (1 to 25), `side`, `marginUsd`, `leverage` (1 to 1000), `exitPrice`, `exitMovePct`, `window` (`24h`, `7d`, `30d`, `all`), `limit` (1 to 25). Unknown fields are rejected. The complete JSON Schemas, `outputSchema` included, are returned by `tools/list` and listed in the [server card](/.well-known/mcp/server-card.json).

## Examples

Initialize:

```bash
curl -s https://papertrade-x402.pages.dev/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

List tools:

```bash
curl -s https://papertrade-x402.pages.dev/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Call a free tool with real data:

```bash
curl -s https://papertrade-x402.pages.dev/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_markets","arguments":{}}}'
```

Ask for payment requirements of a paid tool:

```bash
curl -s https://papertrade-x402.pages.dev/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"wallet_risk","arguments":{"address":"0x3f139ef9f371fbbfc299aa65b93534e177141b18"}}}'
```

The result's `structuredContent` has `status` (`ready` or `payments_not_configured`), `x402Version`, `accepts`, `price`, the exact `request` to send, `howToPay` and a `note`.

Inspect with the official inspector:

```bash
npx @modelcontextprotocol/inspector --cli https://papertrade-x402.pages.dev/mcp --transport http --method tools/list
```

## Errors

Protocol errors use JSON-RPC codes: `-32700` parse error (HTTP 400), `-32600` invalid request, `-32601` unknown method, `-32602` invalid params or unknown tool. Tool failures return a normal result with `isError: true` and a message the model can act on. Unexpected exceptions return a generic message and never leak internals.

## Limits

Request bodies are capped at 64 KB. Each client is limited per isolate to 120 requests per minute, and tool calls are cost-weighted at 40 per minute (live-data tools cost more than status calls). Exceeding a limit returns HTTP 429 with `Retry-After`, or `isError` for a tool call.
