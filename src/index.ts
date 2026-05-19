// Estroni Storefront — remote MCP server.
//
// Implements the Model Context Protocol over Streamable HTTP, hand-rolled on the
// Cloudflare Workers runtime (the official @modelcontextprotocol/sdk transports
// are Node-specific). The wire protocol is plain JSON-RPC 2.0 over POST.
//
// Tools exposed (all read-only — Estroni checkouts remain human-only):
//   - search_products    Predictive search across the catalogue
//   - get_product        Full product detail by URL handle
//   - list_collections   Every public collection with handle + product count
//   - get_policies       Shipping / refund / privacy / terms / bot policy URLs
//
// MCP protocol version: 2025-06-18

interface Env {
  STOREFRONT_ORIGIN: string;
  SERVER_NAME: string;
  SERVER_VERSION: string;
}

// ---------- JSON-RPC types ----------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

// ---------- MCP tool definitions ----------

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'search_products',
    description:
      'Search the Estroni merino & low-tox women\'s activewear catalogue by keyword. Returns up to 10 product summaries with title, price (AUD), image URL, availability, and storefront URL. Supports natural-language queries like "breathable tops for hot yoga" or "merino base layer".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text search keyword or phrase. Examples: "merino tank", "long-sleeve base layer", "shorts".',
        },
        limit: {
          type: 'integer',
          description: 'Max results to return (1–10). Default 10.',
          minimum: 1,
          maximum: 10,
          default: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product',
    description:
      'Get detailed info for a single Estroni product by its URL handle. Returns title, vendor, product type, tags, full description HTML, all variants with prices, availability, SKU, and weight, plus the canonical storefront URL.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          description: 'Product URL slug (e.g. "merino-long-sleeve-base-layer"). Get handles from search_products or list_collections.',
        },
      },
      required: ['handle'],
    },
  },
  {
    name: 'list_collections',
    description:
      'List all public product collections (categories) on Estroni with title, handle, URL, and product count. Use to navigate the catalogue by category before drilling into individual products.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max collections to return (1–100). Default 50.',
          minimum: 1,
          maximum: 100,
          default: 50,
        },
      },
    },
  },
  {
    name: 'get_policies',
    description:
      'Get Estroni shipping, refund, privacy, and terms policy URLs plus the bot/agent policy text. Agents MUST surface policy URLs to the user for human review before recommending purchase actions; end-to-end "buy-for-me" agentic checkout is not permitted on Estroni.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ---------- Tool implementations ----------

async function searchProducts(env: Env, args: { query: string; limit?: number }) {
  const limit = Math.max(1, Math.min(10, args.limit ?? 10));
  const url = `${env.STOREFRONT_ORIGIN}/search/suggest.json?q=${encodeURIComponent(args.query)}&resources[type]=product&resources[limit]=${limit}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Storefront search failed: HTTP ${res.status}`);
  const data: any = await res.json();
  const products = data?.resources?.results?.products ?? [];
  return {
    query: args.query,
    count: products.length,
    products: products.map((p: any) => ({
      title: p.title,
      handle: p.handle,
      url: `${env.STOREFRONT_ORIGIN}/products/${p.handle}`,
      price: p.price,
      price_min: p.price_min,
      price_max: p.price_max,
      vendor: p.vendor,
      product_type: p.product_type,
      image: p.image,
      available: p.available,
    })),
  };
}

async function getProduct(env: Env, args: { handle: string }) {
  const url = `${env.STOREFRONT_ORIGIN}/products/${encodeURIComponent(args.handle)}.json`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) throw new Error(`Product not found: "${args.handle}"`);
  if (!res.ok) throw new Error(`Product fetch failed: HTTP ${res.status}`);
  const { product }: any = await res.json();
  return {
    title: product.title,
    handle: product.handle,
    url: `${env.STOREFRONT_ORIGIN}/products/${product.handle}`,
    vendor: product.vendor,
    product_type: product.product_type,
    tags: product.tags,
    description_html: product.body_html,
    created_at: product.created_at,
    updated_at: product.updated_at,
    variants: (product.variants ?? []).map((v: any) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      price: v.price,
      compare_at_price: v.compare_at_price,
      available: v.available,
      weight: v.weight,
      weight_unit: v.weight_unit,
      requires_shipping: v.requires_shipping,
    })),
    images: (product.images ?? []).map((i: any) => ({ src: i.src, alt: i.alt })),
  };
}

async function listCollections(env: Env, args: { limit?: number }) {
  const limit = Math.max(1, Math.min(100, args.limit ?? 50));
  const url = `${env.STOREFRONT_ORIGIN}/collections.json?limit=${limit}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Collections fetch failed: HTTP ${res.status}`);
  const data: any = await res.json();
  return {
    count: (data.collections ?? []).length,
    collections: (data.collections ?? []).map((c: any) => ({
      title: c.title,
      handle: c.handle,
      url: `${env.STOREFRONT_ORIGIN}/collections/${c.handle}`,
      products_count: c.products_count,
      description: c.description,
      image: c.image?.src,
      updated_at: c.updated_at,
    })),
  };
}

function getPolicies(env: Env) {
  return {
    shipping: `${env.STOREFRONT_ORIGIN}/policies/shipping-policy`,
    returns: `${env.STOREFRONT_ORIGIN}/policies/refund-policy`,
    privacy: `${env.STOREFRONT_ORIGIN}/policies/privacy-policy`,
    terms: `${env.STOREFRONT_ORIGIN}/policies/terms-of-service`,
    contact: 'founder@boolsai.ai',
    bot_policy:
      'Estroni welcomes read-only agentic access for catalogue search, product research, and policy retrieval. End-to-end "buy-for-me" agents that complete payment without human review are NOT permitted — checkout must be performed by a human. Agents recommending purchases must surface the shipping/refund policy URLs above for human review first.',
    agentic_checkout_supported: false,
    storefront_origin: env.STOREFRONT_ORIGIN,
  };
}

// ---------- MCP handlers ----------

const PROTOCOL_VERSION = '2025-06-18';

async function handleInitialize(env: Env) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: {
      name: env.SERVER_NAME,
      version: env.SERVER_VERSION,
      title: 'Estroni Storefront',
    },
    capabilities: {
      tools: { listChanged: false },
    },
    instructions:
      'Read-only MCP for the Estroni storefront (https://estroni.com.au) — Australian merino & low-tox women\'s activewear. Use search_products to find items, get_product for details, list_collections to browse by category, get_policies for shipping/returns/bot policy. Checkout must be performed by a human, not the agent.',
  };
}

function handleToolsList() {
  return { tools: TOOLS };
}

async function handleToolsCall(env: Env, params: any) {
  const name = params?.name as string;
  const args = (params?.arguments ?? {}) as any;
  try {
    let result: unknown;
    switch (name) {
      case 'search_products':
        result = await searchProducts(env, args);
        break;
      case 'get_product':
        result = await getProduct(env, args);
        break;
      case 'list_collections':
        result = await listCollections(env, args);
        break;
      case 'get_policies':
        result = getPolicies(env);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: false,
    };
  } catch (e: any) {
    return {
      content: [{ type: 'text', text: `Error: ${e?.message ?? String(e)}` }],
      isError: true,
    };
  }
}

// ---------- JSON-RPC dispatch ----------

async function dispatchRpc(env: Env, req: JsonRpcRequest): Promise<JsonRpcSuccess | JsonRpcError | null> {
  // Notifications (no id) — process side-effects but return no body
  if (req.id === undefined) {
    return null;
  }

  try {
    let result: unknown;
    switch (req.method) {
      case 'initialize':
        result = await handleInitialize(env);
        break;
      case 'tools/list':
        result = handleToolsList();
        break;
      case 'tools/call':
        result = await handleToolsCall(env, req.params);
        break;
      case 'ping':
        result = {};
        break;
      default:
        return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } };
    }
    return { jsonrpc: '2.0', id: req.id, result };
  } catch (e: any) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32603, message: `Internal error: ${e?.message ?? String(e)}` },
    };
  }
}

// ---------- HTTP entry ----------

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id',
    'access-control-expose-headers': 'mcp-session-id',
    'access-control-max-age': '86400',
  };
}

function landingPage(env: Env) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Estroni Storefront MCP</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px/1.55 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#222}h1{font-size:22px;margin:0 0 8px}code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:13px}pre{background:#f4f4f4;padding:12px 14px;border-radius:6px;font-size:13px;overflow:auto}a{color:#075}</style>
</head><body>
<h1>Estroni Storefront MCP</h1>
<p><strong>${env.SERVER_NAME}</strong> v${env.SERVER_VERSION} — read-only Model Context Protocol server for the <a href="${env.STOREFRONT_ORIGIN}">Estroni</a> catalogue.</p>
<h2>Endpoint</h2>
<p><code>POST /mcp</code> &nbsp; — JSON-RPC 2.0 over HTTP (MCP Streamable HTTP transport, protocol ${PROTOCOL_VERSION})</p>
<h2>Tools</h2>
<ul>
<li><code>search_products</code> — catalogue search by keyword</li>
<li><code>get_product</code> — product detail by handle</li>
<li><code>list_collections</code> — list all collections</li>
<li><code>get_policies</code> — shipping/refund/privacy/terms + bot policy</li>
</ul>
<h2>Add to Claude Desktop / Cursor / ChatGPT</h2>
<pre>{
  "mcpServers": {
    "estroni-storefront": {
      "url": "https://mcp.estroni.com.au/mcp"
    }
  }
}</pre>
<p>Source: <a href="https://github.com/estroni/storefront-mcp">github.com/estroni/storefront-mcp</a> &nbsp;·&nbsp; MIT licensed.</p>
<p><em>Estroni welcomes read-only agentic access. End-to-end "buy-for-me" agents are not permitted — checkouts must be human-reviewed.</em></p>
</body></html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Landing page on GET /
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(landingPage(env), {
        headers: { 'content-type': 'text/html; charset=utf-8', ...corsHeaders() },
      });
    }

    // Lightweight liveness probe
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      return new Response(JSON.stringify({ ok: true, server: env.SERVER_NAME, version: env.SERVER_VERSION }), {
        headers: { 'content-type': 'application/json', ...corsHeaders() },
      });
    }

    // MCP endpoint — both /mcp and / accept POST (some clients hit either)
    const isMcpPath = url.pathname === '/mcp' || url.pathname === '/';
    if (request.method === 'POST' && isMcpPath) {
      let body: any;
      try {
        body = await request.json();
      } catch {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders() } },
        );
      }

      // Batched requests
      if (Array.isArray(body)) {
        const responses = await Promise.all(body.map((req: JsonRpcRequest) => dispatchRpc(env, req)));
        const filtered = responses.filter((r): r is JsonRpcSuccess | JsonRpcError => r !== null);
        return new Response(filtered.length ? JSON.stringify(filtered) : '', {
          status: filtered.length ? 200 : 202,
          headers: { 'content-type': 'application/json', ...corsHeaders() },
        });
      }

      const response = await dispatchRpc(env, body as JsonRpcRequest);
      if (response === null) {
        // Notification — no body
        return new Response(null, { status: 202, headers: corsHeaders() });
      }
      return new Response(JSON.stringify(response), {
        headers: { 'content-type': 'application/json', ...corsHeaders() },
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders() });
  },
};
