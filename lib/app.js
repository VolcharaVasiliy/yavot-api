// Framework-agnostic core of yavot-api.
// `app()` takes a normalized request and returns a normalized response so the same
// logic runs on Vercel (Node http), a local server, and Cloudflare Workers (Fetch API).

import VOTClient from "@vot.js/node";
import { getVideoData } from "@vot.js/node/utils/videoData";
import { makeClient } from "./client.js";
import { resolveMediaUrl } from "./resolver.js";
import { resolveViaYtdlpOnline } from "./ytdlpOnline.js";

const DEFAULT_REQ_LANG = "auto";
const DEFAULT_RES_LANG = "ru";
const POLL_BUDGET_MS = Number(process.env.POLL_BUDGET_MS || 9000);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

async function resolveVideoData(url, directUrl) {
  try {
    return await getVideoData(url);
  } catch {
    return { url: directUrl || url, duration: 0 };
  }
}

function authHeaders({ sessionId, apiToken }) {
  if (sessionId) return { Cookie: `Session_id=${sessionId}` };
  return {};
}

async function poll(client, opts, maxMs) {
  const deadline = Date.now() + maxMs;
  let last = null;
  let attempts = 0;
  while (Date.now() < deadline) {
    try {
      const res = await client.translateVideo(opts);
      last = res;
      const done =
        res.translated &&
        (res.remainingTime === null ||
          res.remainingTime === undefined ||
          res.remainingTime <= 0);
      if (done) return res;
      const wait = Math.min(Math.max(res.remainingTime ?? 5, 1), 5) * 1000;
      if (Date.now() + wait >= deadline) break;
      await new Promise((r) => setTimeout(r, wait));
    } catch (e) {
      attempts++;
      if (attempts > 5 || Date.now() + 3000 >= deadline) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return last;
}

function endpoint(pathname) {
  if (pathname === "/translate" || pathname === "/video-translation") return "translate";
  if (pathname === "/subtitles" || pathname === "/video-subtitles") return "subtitles";
  return "index";
}

export async function app({ method = "GET", pathname = "/", headers = {}, body = null }) {
  if (method === "OPTIONS") return { status: 204, headers: CORS, body: "" };

  const ep = endpoint(pathname);

  if (method === "GET") {
    return {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: {
        service: "yavot-api",
        endpoints: { translate: "POST /translate", subtitles: "POST /subtitles" },
      },
    };
  }

  if (method !== "POST") {
    return {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: { error: "Method not allowed. Use POST." },
    };
  }

  let parsed;
  try {
    parsed = typeof body === "string" ? JSON.parse(body || "{}") : body || {};
  } catch {
    return {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: { error: "Invalid JSON body" },
    };
  }

  const {
    url,
    directUrl,
    sourceLang = DEFAULT_REQ_LANG,
    targetLang = DEFAULT_RES_LANG,
    lively = false,
    sessionId,
    apiToken,
    wait = false,
  } = parsed;

  if (!url) {
    return {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: { error: "Field 'url' is required" },
    };
  }

  const envSession = sessionId || process.env.YANDEX_SESSION_ID;
  const env = apiToken || process.env.YANDEX_API_TOKEN;
  const resolverUrl = process.env.RESOLVER_URL || "";

  try {
    // Auto-resolve a direct media URL for arbitrary (non-YouTube, non-direct) pages.
    let effectiveDirect = directUrl;
    if (!effectiveDirect) {
      let isDirect = false;
      let isYouTube = false;
      try {
        const u = new URL(url);
        isDirect = /\.(mp4|webm|m3u8)(\?|$|#)/i.test(u.pathname);
        isYouTube = /(^|\.)youtu\.?be(\.|$)/.test(u.hostname);
      } catch {
        /* invalid URL handled later by getVideoData */
      }
      if (!isDirect && !isYouTube && resolverUrl) {
        try {
          effectiveDirect = await resolveMediaUrl(url, { resolverUrl });
        } catch (e) {
          return {
            status: 502,
            headers: { ...CORS, "Content-Type": "application/json" },
            body: {
              error: "Media resolution failed",
              detail: String(e.message || e),
              hint: "Pass 'directUrl' explicitly, or ensure RESOLVER_URL is reachable.",
            },
          };
        }
      } else if (!isDirect && !isYouTube && process.env.YTDLP_ONLINE) {
        try {
          effectiveDirect = await resolveViaYtdlpOnline(url, {
            cookie: process.env.YTDLP_ONLINE_COOKIE || "",
            timeoutMs: 45000,
          });
        } catch (e) {
          return {
            status: 502,
            headers: { ...CORS, "Content-Type": "application/json" },
            body: {
              error: "ytdlp.online resolution failed",
              detail: String(e.message || e),
              hint: "Pass 'directUrl' explicitly, or check YTDLP_ONLINE_COOKIE.",
            },
          };
        }
      }
    }

    const videoData = await resolveVideoData(url, effectiveDirect);
    const client = makeClient({ sessionId: envSession, apiToken: env });

    if (ep === "subtitles") {
      const subs = await client.getSubtitles({ videoData, requestLang: sourceLang });
      return {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: { waiting: subs.waiting, subtitles: subs.subtitles },
      };
    }

    const opts = { videoData, requestLang: sourceLang, responseLang: targetLang };
    if (effectiveDirect) {
      opts.translationHelp = [{ target: "video_file_url", targetUrl: effectiveDirect }];
    }
    if (lively) {
      opts.extraOpts = { useLivelyVoice: true };
      const h = authHeaders({ sessionId: envSession, apiToken: env });
      if (Object.keys(h).length) opts.headers = h;
    }

    let result;
    if (wait) {
      result = await poll(client, opts, POLL_BUDGET_MS);
    } else {
      result = await client.translateVideo(opts);
    }

    return {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: {
        status: result.translated ? "translated" : "waiting",
        audioUrl: result.url ?? null,
        translationId: result.translationId ?? null,
        remainingTime: result.remainingTime ?? null,
        raw: result,
      },
    };
  } catch (err) {
    return {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: { error: String(err?.message || err) },
    };
  }
}
