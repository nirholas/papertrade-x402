---
title: Agent discovery
description: Every machine-readable file the service publishes so agents and crawlers can find and understand it.
---

# Agent discovery

Everything an agent needs to find, understand and call this service is published as a real file or endpoint.

| URL | Format | Purpose |
| --- | --- | --- |
| `/.well-known/x402` | JSON | x402 and bazaar discovery: resources, prices, accepted networks, payTo, input and output schemas with examples, preview routes, status |
| `/openapi.json` | OpenAPI 3.1 | Every route including previews and `/mcp`, with `x-payment-info` |
| `/mcp` | MCP Streamable HTTP | Tool server, see [MCP](/docs/mcp/) |
| `/.well-known/mcp/server-card.json` | JSON (SEP-1649) | Server info, transport endpoint, capabilities, tool list. Alias at `/.well-known/mcp.json` |
| `/.well-known/agent-card.json` | JSON (A2A) | Agent card with one skill per tool. Alias at `/.well-known/agent.json` |
| `/.well-known/api-catalog` | `application/linkset+json` (RFC 9727) | Catalog linking the OpenAPI document, MCP endpoint, docs and llms.txt |
| `/llms.txt` | text | Short index for language models |
| `/llms-full.txt` | text | Full documentation inlined |
| `/docs/*.md` | markdown | Raw markdown twin of every docs page |
| `/robots.txt` | text | Crawl policy with Content-Signal and explicit AI bot allowances |
| `/sitemap.xml` | XML | All pages |

The landing page also sends `Link` headers: `rel="service-desc"` for the OpenAPI document, `rel="api-catalog"`, `rel="mcp-server"`, `rel="service-doc"` for the docs and `rel="describedby"` for llms.txt.

## x402 bazaar discovery

`/.well-known/x402` follows the convention x402 crawlers read: `version` plus absolute `resources`, and the richer `x402Version` 2 body with `endpoints`. Each endpoint carries `accepts` (empty until the operator sets a payout address), a `bazaar` entry in `extensions` with the input example, input schema, output example and output schema, plus the free `preview` route. The 402 responses embed the same bazaar extension so a facilitator can catalog the resource after the first settled payment.

## Status field

`status` is `accepting_payments` or `payments_not_configured`. A crawler or agent should treat the second as "free tier only for now" and not as an outage.

## Crawl policy

`robots.txt` allows the open web, disallows `/api/` for generic crawlers, and explicitly allows GPTBot, ClaudeBot, Claude-User, OAI-SearchBot, Google-Extended and PerplexityBot, with `Content-Signal: search=yes, ai-input=yes, ai-train=no`.
