# AGENTS.md

Guidance for AI agents working on or consuming papertrade-x402.

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install (needs `../papertrade-sdk-0.1.0.tgz`). |
| `npm run typecheck` | `tsc --noEmit` for the root and `-p site/functions`. |
| `npm test` | Vitest. Some tests call the live PayAI facilitator and Papertrade API. |
| `npm run build:site` | Bundle `site/app.ts`, then build `/docs/`, `llms.txt`, `llms-full.txt` and the sitemap from `docs/*.md` (`scripts/build-docs.mjs`). |
| `npm run gen:examples` | Regenerate `src/examples.json` from recorded fixtures. |
| `npm run dev:site` | `wrangler pages dev --port 8793` from `site/`. Needs `site/.dev.vars`. |
| `npm run build` | Compile `src/client.ts` to `dist/` for npm. |

## Correctness rules

- Use `papertrade-sdk` for every protocol read and formula (`estimateClose`, `liquidationPriceRaw`). Do not reimplement the math.
- Raw wad values are 1e18. Convert only at the edge.
- Order in the `/api/v1/*` guard is fixed: validate input (free 400), configuration gate (503), then payment middleware. Never settle before the handler succeeds.
- Prices come only from wrangler vars. payTo addresses come only from env. Never hardcode either.
- Untrusted strings (addresses, names) are escaped or set via `textContent`.
- No em-dash or en-dash characters anywhere.

## Safety rules

- Never sign or send a real payment or transaction, and never handle a real private key. Tests use unpaid calls, throwaway payTo values and malformed payment headers only.
- Do not commit, push, publish or deploy without the owner.
- Secrets: `X402_SOLANA_PAY_TO`, `X402_BASE_PAY_TO` (see `.dev.vars.example`).

## MCP and docs

- `/mcp` is read-only. No tool may sign, send, pay or place an order. Paid tools return x402 requirements only (`src/payment.ts`).
- HTTP routes and MCP tools share `src/handlers.ts`. Plumbing is in `site/functions/_lib/mcp.ts`, tools in `site/functions/_lib/papertrade-mcp.ts`.
- Edit docs in `docs/*.md`, never in `site/public/docs/` (generated, git-ignored). Add a new page to `ORDER` in `scripts/build-docs.mjs`.
- Pages Functions only run for paths in `site/public/_routes.json`. Add any new dynamic path there. `_headers` does not apply to function responses.
- Do not invent a payout address. Paid routes stay 503 until the owner sets `X402_SOLANA_PAY_TO`.

## Layout

| Path | What |
| --- | --- |
| `src/app.ts` | Hono app, routes, guard order. |
| `src/x402.ts` | Route pricing, resource server, payment middleware. |
| `src/config.ts` | Env resolution and validation. |
| `src/risk.ts`, `liquidations.ts`, `estimate.ts`, `traders.ts` | Pure computations over SDK data. |
| `src/data.ts` | Papertrade reads with timeouts and retries. |
| `src/discovery.ts`, `openapi.ts` | `/.well-known/x402` and `/openapi.json`. |
| `src/client.ts` | Published typed client with dry run. |
| `site/functions/[[path]].ts` | Pages Functions catch-all serving the Hono app. |
| `site/public`, `site/app.ts` | Landing page. |
| `test/` | Vitest suites and recorded live fixtures. |
