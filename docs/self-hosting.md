---
title: Self-hosting
description: Deploy your own instance on Cloudflare Pages and set the payout address secret.
---

# Self-hosting on Cloudflare

The whole service is one Cloudflare Pages project: static files in `site/public`, Pages Functions in `site/functions`, and the Hono app in `src`. There is no database and no queue.

## Deploy

```bash
git clone https://github.com/nirholas/papertrade-x402.git
cd papertrade-x402
npm install
npm run build:site
cd site
npx wrangler pages deploy --project-name <your-project> --branch main
```

`npm run build:site` bundles the landing script and builds the docs, the `llms.txt` files and the sitemap.

## Enable payments: set the payout address

Paid routes answer `503 not_configured` until the operator sets a payout address. The address is the operator's decision, and it is stored as a Pages secret, never in the repository. From the `site/` directory, one command:

```bash
npx wrangler pages secret put X402_SOLANA_PAY_TO
```

Paste your Solana wallet address when prompted (the wallet that should receive USDC). Pages secrets apply to the next deployment, so redeploy afterwards (the deploy command above). To also accept Base USDC:

```bash
npx wrangler pages secret put X402_BASE_PAY_TO
```

Verify:

```bash
curl -s https://<your-project>.pages.dev/.well-known/x402 | jq '{status, configured, networks}'
curl -si https://<your-project>.pages.dev/api/v1/liquidations/nearby | head -5
```

`status` becomes `accepting_payments` and paid routes now answer `402` with your address in `accepts`. Invalid addresses are reported under `problems` instead of being used.

## Configuration

| Name | Kind | Default | Purpose |
| --- | --- | --- | --- |
| `X402_SOLANA_PAY_TO` | secret | unset | Solana address that receives USDC. Required for Solana. |
| `X402_BASE_PAY_TO` | secret | unset | EVM address for Base USDC. Optional. |
| `X402_FACILITATOR_URL` | var | `https://facilitator.payai.network` | x402 facilitator |
| `PAPERTRADE_API_URL` | var | `https://exchange.papertrade.xyz` | Papertrade exchange API |
| `PRICE_WALLET_RISK` | var | `0.02` | USDC per call |
| `PRICE_LIQUIDATIONS_NEARBY` | var | `0.05` | USDC per call |
| `PRICE_ESTIMATE` | var | `0.005` | USDC per call |
| `PRICE_TRADERS_TOP` | var | `0.03` | USDC per call |

Vars live in `site/wrangler.toml`. Prices are validated: a value that is not a positive USDC amount is reported in `problems` and the default is kept.

## Local development

```bash
cp .dev.vars.example site/.dev.vars
npm run dev:site
```

`site/.dev.vars` is git-ignored. Use throwaway addresses locally, never a key.

## Embedding

The landing page can be framed by `https://papertrade-os.pages.dev` and any `*.pages.dev` origin (`frame-ancestors` in `site/public/_headers`). Add `?embed=1` to hide the marketing chrome. Documentation pages are never frameable.
