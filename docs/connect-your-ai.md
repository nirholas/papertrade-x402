---
title: Connect your AI
description: Copy-paste setup for Claude, Codex, ChatGPT, Gemini, Cursor, VS Code, Windsurf, Zed, Cline, Goose and Continue.
---

# Connect your AI

The MCP endpoint is `https://papertrade-x402.pages.dev/mcp` (Streamable HTTP, no authentication). It exposes free tools directly. Paid tools return x402 payment requirements and never pay, so connecting an assistant cannot spend money. Client configuration formats change quickly; each snippet below was checked against the client's current documentation, and if a client moves a setting, its own docs win.

## Claude Code

```bash
claude mcp add --transport http papertrade-x402 https://papertrade-x402.pages.dev/mcp
```

Add `--scope user` to make it available in every project, or commit a project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "papertrade-x402": { "type": "http", "url": "https://papertrade-x402.pages.dev/mcp" }
  }
}
```

## Claude Desktop and claude.ai

Open Settings, then Connectors, then Add custom connector, and paste `https://papertrade-x402.pages.dev/mcp`. No sign-in is needed.

Claude Desktop can also reach remote servers through the `mcp-remote` stdio bridge in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "papertrade-x402": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://papertrade-x402.pages.dev/mcp"]
    }
  }
}
```

## Claude API (MCP connector)

The connector is a beta. Current header: `mcp-client-2025-11-20`. Declare the server in `mcp_servers` and enable it with an `mcp_toolset` entry:

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-11-20" -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-5-5",
    "max_tokens": 1000,
    "messages": [{"role": "user", "content": "What is the BTC liquidation picture on Papertrade right now?"}],
    "mcp_servers": [{"type": "url", "url": "https://papertrade-x402.pages.dev/mcp", "name": "papertrade-x402"}],
    "tools": [{"type": "mcp_toolset", "mcp_server_name": "papertrade-x402"}]
  }'
```

## OpenAI Codex CLI

Add a Streamable HTTP server to `~/.codex/config.toml`:

```toml
[mcp_servers.papertrade-x402]
url = "https://papertrade-x402.pages.dev/mcp"
```

Or from the shell:

```bash
codex mcp add papertrade-x402 --url https://papertrade-x402.pages.dev/mcp
```

## OpenAI Responses API

```bash
curl https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "tools": [{
      "type": "mcp",
      "server_label": "papertrade_x402",
      "server_url": "https://papertrade-x402.pages.dev/mcp",
      "require_approval": "never"
    }],
    "input": "Estimate a 100x BTC long with 100 USD margin on Papertrade."
  }'
```

`require_approval: "never"` is safe here because every tool is read-only. Use `"always"` if your policy requires approval for all tool calls.

## ChatGPT

Enable developer mode (Settings, Apps and Connectors, Advanced), then create a connector with the URL `https://papertrade-x402.pages.dev/mcp` and authentication set to none.

## Gemini CLI

In `~/.gemini/settings.json` (or the project `.gemini/settings.json`):

```json
{
  "mcpServers": {
    "papertrade-x402": { "httpUrl": "https://papertrade-x402.pages.dev/mcp" }
  }
}
```

Or: `gemini mcp add --transport http papertrade-x402 https://papertrade-x402.pages.dev/mcp`.

## Cursor

`.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "papertrade-x402": { "url": "https://papertrade-x402.pages.dev/mcp" }
  }
}
```

## VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "papertrade-x402": { "type": "http", "url": "https://papertrade-x402.pages.dev/mcp" }
  }
}
```

## Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "papertrade-x402": { "serverUrl": "https://papertrade-x402.pages.dev/mcp" }
  }
}
```

## Zed

In Zed `settings.json`:

```json
{
  "context_servers": {
    "papertrade-x402": { "url": "https://papertrade-x402.pages.dev/mcp" }
  }
}
```

## Cline

In `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "papertrade-x402": { "url": "https://papertrade-x402.pages.dev/mcp", "type": "streamableHttp" }
  }
}
```

## Goose

Run `goose configure`, choose Add Extension, then Remote Extension (Streaming HTTP), and enter the endpoint. Or in `~/.config/goose/config.yaml`:

```yaml
extensions:
  papertrade-x402:
    enabled: true
    type: streamable_http
    name: papertrade-x402
    uri: https://papertrade-x402.pages.dev/mcp
    timeout: 300
```

## Continue

`.continue/mcpServers/papertrade-x402.yaml`:

```yaml
name: Papertrade x402
version: 0.0.1
schema: v1
mcpServers:
  - name: papertrade-x402
    type: streamable-http
    url: https://papertrade-x402.pages.dev/mcp
```

## Any other agent framework

Anything that speaks OpenAPI can import [`/openapi.json`](/openapi.json). Anything that speaks x402 can read [`/.well-known/x402`](/.well-known/x402). Frameworks that take a plain tool list can read `tools/list` from the MCP endpoint and map each `inputSchema` to a function definition.

## Try it

After connecting, ask: "Use Papertrade to show current markets, then preview the liquidation map around BTC." Both calls are free and return live data. Paying for the full answer is a separate, explicit step you or your agent take with your own wallet: see [Paying as an agent](/docs/paying-as-an-agent/).
