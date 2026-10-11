# Changelog

## Unreleased

- Read-only MCP server at `/mcp` (Streamable HTTP, stateless, batches, SSE framing, CORS) with ten tools: six free, four paid tools that return x402 requirements and never pay.
- Free preview tier under `/api/v1/preview/*`, rate limited, running the same live computation with detail withheld.
- Paid routes answer an explanatory 503 (with links to the free tier and the operator command) until a payout address is set. No address is ever invented.
- Discovery: x402 bazaar extensions with input and output schemas and real examples, MCP server card, A2A agent card, RFC 9727 api-catalog, OpenAPI preview and MCP paths, `Link` headers, robots with Content-Signal, sitemap, `server.json`, `glama.json`.
- Documentation site at `/docs/` generated from `docs/*.md` with search, markdown twins, `llms.txt` and `llms-full.txt`.
- Landing page: Connect your AI, MCP tools, works-with strip, live "Try it" with a free preview mode, `?embed=1` and an "Open in Papertrade OS" link, `frame-ancestors` for the OS.

## 0.1.0 - 2026-10-10

Initial release.

- Four paid endpoints: wallet liquidation risk, nearby liquidation map, close/bust estimate, top traders.
- Free endpoints: health, markets, OpenAPI 3.1, x402 discovery.
- x402 v2 with the PayAI facilitator: USDC on Solana first, Base second. Verify before the handler, settle only after a 2xx.
- Operator-configurable prices through wrangler vars; payTo addresses from environment only, 503 when unset.
- `PapertradeX402` typed client with a dry-run mode, publishable from `src/client.ts`.
- Landing page with live markets, endpoint catalog, curl examples and an interactive "Try the 402" form.
- Tests against recorded real Papertrade fixtures, x402 schema validation of the 402 shape, and facilitator rejection of malformed payments.
