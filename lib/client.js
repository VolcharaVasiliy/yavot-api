// Two runtime paths:
//  - Cloudflare Workers: use @vot.js/core + the runtime's native fetch. No undici,
//    no Node-only globals (undici's web/webidl needs `MessagePort`, which Workers lack).
//  - Node / Vercel: use @vot.js/node + undici, with VOTAgent / VOTProxyAgent that strip
//    the `sec-fetch-mode` header the Yandex balancer rejects (HTTP 402).
//
// undici / @vot.js/node are imported dynamically and only on the Node path, so the
// Cloudflare Worker bundle never evaluates them.
const PROXY_URL =
  (typeof process !== "undefined" && process.env && process.env.YAVOT_PROXY) || undefined;

const isWorker = () => globalThis.YAVOT_RUNTIME === "worker";

let nodeImpl = null;
async function loadNodeImpl() {
  if (nodeImpl) return nodeImpl;
  const VOTNode = await import("@vot.js/node");
  const { fetch: undiciFetch } = await import("undici");
  const { VOTAgent, VOTProxyAgent } = await import("@vot.js/node/utils/fetchAgent");
  nodeImpl = { VOTClient: VOTNode.default, undiciFetch, VOTAgent, VOTProxyAgent };
  return nodeImpl;
}

let coreImpl = null;
async function loadCoreImpl() {
  if (coreImpl) return coreImpl;
  const { default: VOTClient } = await import("@vot.js/core");
  coreImpl = { VOTClient };
  return coreImpl;
}

export async function makeClient({ sessionId, apiToken } = {}) {
  const opts = {};
  if (apiToken) opts.apiToken = apiToken;

  if (isWorker()) {
    const { VOTClient } = await loadCoreImpl();
    // Defensive: strip any sec-fetch-* headers so Yandex's balancer doesn't 402.
    // (Node's undici fetch adds them; workerd usually doesn't, but this is harmless.)
    const stripSecFetch = (input, init = {}) => {
      const h = new Headers(
        init?.headers ?? (typeof input !== "string" && input?.headers ? input.headers : {}),
      );
      for (const k of [...h.keys()]) {
        if (k.toLowerCase().startsWith("sec-fetch-")) h.delete(k);
      }
      return globalThis.fetch(input, { ...init, headers: h });
    };
    const client = new VOTClient({ ...opts, fetchFn: stripSecFetch, fetchOpts: {} });
    return client;
  }

  const { VOTClient, undiciFetch, VOTAgent, VOTProxyAgent } = await loadNodeImpl();
  let dispatcher;
  if (PROXY_URL && PROXY_URL !== "off") {
    dispatcher = new VOTProxyAgent(PROXY_URL, {
      connect: { timeout: 30000 },
      pipelining: 0,
      keepAliveMaxTimeout: 0,
    });
  } else {
    dispatcher = new VOTAgent();
  }
  const client = new VOTClient({ ...opts });
  client.provider.fetch = undiciFetch;
  client.provider.fetchOpts = { dispatcher };
  return client;
}
