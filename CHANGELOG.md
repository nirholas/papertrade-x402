# Changelog

## 0.1.0 - 2026-10-10

Initial release.

- Four paid endpoints: wallet liquidation risk, nearby liquidation map, close/bust estimate, top traders.
- Free endpoints: health, markets, OpenAPI 3.1, x402 discovery.
- x402 v2 with the PayAI facilitator: USDC on Solana first, Base second. Verify before the handler, settle only after a 2xx.
- Operator-configurable prices through wrangler vars; payTo addresses from environment only, 503 when unset.
- `PapertradeX402` typed client with a dry-run mode, publishable from `src/client.ts`.
- Landing page with live markets, endpoint catalog, curl examples and an interactive "Try the 402" form.
- Tests against recorded real Papertrade fixtures, x402 schema validation of the 402 shape, and facilitator rejection of malformed payments.
