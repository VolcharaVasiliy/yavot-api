// Cloudflare Workers entrypoint for yavot-api.
// Reuses the framework-agnostic core in lib/app.js. Cloudflare env bindings are
// bridged into process.env so the shared code (which reads process.env.*) works as-is.

import { app } from "./lib/app.js";

// Mark the runtime so lib/client.js uses the Worker-compatible (@vot.js/core) path
// and never loads undici (which needs Node-only globals).
globalThis.YAVOT_RUNTIME = "worker";

export default {
  async fetch(request, env) {
    if (env) {
      for (const k of Object.keys(env)) {
        if (env[k] != null) process.env[k] = env[k];
      }
    }

    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.text() : null;

    const result = await app({
      method: request.method,
      pathname: url.pathname,
      headers: Object.fromEntries(request.headers),
      body,
    });

    return new Response(
      typeof result.body === "string" ? result.body : JSON.stringify(result.body),
      { status: result.status, headers: result.headers },
    );
  },
};
