import VOTClient from "@vot.js/node";
import { fetch as undiciFetch } from "undici";
import { VOTAgent, VOTProxyAgent } from "@vot.js/node/utils/fetchAgent";

// Proxy support (optional):
//  - unset / YAVOT_PROXY=off  -> direct connection via VOTAgent
//  - YAVOT_PROXY=<url>        -> route through the given HTTP(S) proxy (e.g. Clash)
// VOTAgent / VOTProxyAgent strip the `sec-fetch-mode` header that the Yandex
// balancer rejects (otherwise it returns HTTP 402). We always use undici's own
// fetch + a dispatcher because Node 24's built-in fetch is incompatible with
// undici's Dispatcher instances ("invalid onRequestStart").
const PROXY_URL = process.env.YAVOT_PROXY;

let dispatcher;
if (PROXY_URL && PROXY_URL !== "off") {
  // Higher connect timeout + no connection reuse to avoid dead-tunnel reuse
  // through the proxy after a prior response (UND_ERR_CONNECT_TIMEOUT).
  dispatcher = new VOTProxyAgent(PROXY_URL, {
    connect: { timeout: 30000 },
    pipelining: 0,
    keepAliveMaxTimeout: 0,
  });
} else {
  dispatcher = new VOTAgent();
}

export function makeClient({ sessionId, apiToken } = {}) {
  const opts = {};
  if (apiToken) opts.apiToken = apiToken;
  const client = new VOTClient(opts);
  client.provider.fetch = undiciFetch;
  client.provider.fetchOpts = { dispatcher };
  return client;
}
