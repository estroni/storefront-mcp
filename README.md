# Estroni Storefront — MCP server

[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Read-only **Model Context Protocol** server for the [Estroni](https://estroni.com.au) storefront — Australian merino & low-tox women's activewear.

Lets AI agents (Claude, ChatGPT, Cursor, Copilot, etc.) search the catalogue, fetch product detail, list collections, and read shipping/return policies. Built for **agent-driven product discovery and research**, not checkout — Estroni's checkout remains a human-only flow by policy.

- **Registry name:** `io.github.estroni/storefront`
- **Transport:** Streamable HTTP (MCP protocol `2025-06-18`)
- **Endpoint:** `https://mcp.estroni.com.au/mcp`
- **Runtime:** Cloudflare Workers
- **Source:** [github.com/estroni/storefront-mcp](https://github.com/estroni/storefront-mcp)

---

## Tools

| Tool | What it returns |
|---|---|
| `search_products` | Up to 10 product summaries (title, price AUD, image, availability, URL) matching a keyword query |
| `get_product` | Full product detail by URL handle — variants, prices, SKU, description HTML, images |
| `list_collections` | Every public collection with title, handle, URL, and product count |
| `get_policies` | Shipping / refund / privacy / terms URLs + bot/agent policy text |

All four tools are **read-only**. They wrap Shopify's public storefront JSON endpoints — no authentication required from the calling agent.

---

## Install

### Claude Desktop / Cursor / Claude Code

Add to your MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or `mcp.json` in Cursor):

```json
{
  "mcpServers": {
    "estroni-storefront": {
      "url": "https://mcp.estroni.com.au/mcp"
    }
  }
}
```

Restart the client. The four tools appear under the `estroni-storefront` server.

### ChatGPT / Anthropic Claude.ai (Custom Connectors)

Settings → Connectors → Add custom connector → paste `https://mcp.estroni.com.au/mcp`.

### Test from a terminal

```bash
# initialize
curl -sS https://mcp.estroni.com.au/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# list tools
curl -sS https://mcp.estroni.com.au/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call search_products
curl -sS https://mcp.estroni.com.au/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_products","arguments":{"query":"merino"}}}'
```

---

## Example agent prompts

> "Find me a long-sleeve merino base layer on Estroni under $150 AUD."
> → calls `search_products({query: "merino long sleeve base layer"})`, filters, summarises.

> "What's Estroni's return window?"
> → calls `get_policies()` and surfaces the refund-policy URL with a 1-line summary.

> "Show me everything in the 'Merino activewear' collection that's in stock."
> → `list_collections()` → `get_product()` per handle → filter by `variants[].available`.

---

## Bot & agent policy

> Estroni welcomes read-only agentic access for catalogue search, product research, and policy retrieval.
>
> **End-to-end "buy-for-me" agents** that complete payment without a final human-review step are **NOT** permitted on Estroni.com.au.
>
> Agents recommending purchases must surface the shipping and refund policy URLs (returned by `get_policies`) for human review before proceeding to checkout.

See also: [estroni.com.au/robots.txt](https://estroni.com.au/robots.txt) — `Content-Signal: search=yes, ai-input=no, ai-train=no`.

---

## Development

```bash
git clone https://github.com/estroni/storefront-mcp.git
cd storefront-mcp
npm install
npm run dev          # wrangler dev — local Worker on http://localhost:8787
npm run typecheck    # tsc --noEmit
npm run deploy       # wrangler deploy → estroni-mcp.workers.dev
```

The MCP wire protocol is hand-rolled (the official `@modelcontextprotocol/sdk` ships Node-only transports; Workers needs its own). Implementation is intentionally minimal — ~300 lines in `src/index.ts`.

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Estroni](https://estroni.com.au) · Contact: founder@boolsai.ai
