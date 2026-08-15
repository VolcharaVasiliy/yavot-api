import VOTClient from "@vot.js/node";
import { getVideoData } from "@vot.js/node/utils/videoData";
import { makeClient } from "../lib/client.js";
import { resolveMediaUrl } from "../lib/resolver.js";
import { resolveViaYtdlpOnline } from "../lib/ytdlpOnline.js";

export const maxDuration = 60;

const DEFAULT_REQ_LANG = "auto";
const DEFAULT_RES_LANG = "ru";
const POLL_BUDGET_MS = Number(process.env.POLL_BUDGET_MS || 9000);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

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
      // Transient network blip (e.g. flaky proxy): retry if budget allows.
      attempts++;
      if (attempts > 5 || Date.now() + 3000 >= deadline) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return last;
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj, null, 2));
}

function endpoint(req) {
  const url = (req.url || "/").split("?")[0];
  if (url === "/translate" || url === "/video-translation") return "translate";
  if (url === "/subtitles" || url === "/video-subtitles") return "subtitles";
  return "index";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  const ep = endpoint(req);

  if (req.method === "OPTIONS") return res.end();
  if (req.method === "GET") {
    return json(res, 200, {
      service: "yavot-api",
      endpoints: {
        translate: "POST /translate",
        subtitles: "POST /subtitles",
      },
    });
  }
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed. Use POST." });
  }

  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
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
  } = body;

  if (!url) return json(res, 400, { error: "Field 'url' is required" });

  const envSession = sessionId || process.env.YANDEX_SESSION_ID;
  const envToken = apiToken || process.env.YANDEX_API_TOKEN;
  const resolverUrl = process.env.RESOLVER_URL || "";

  try {
    // Auto-resolve a direct media URL for arbitrary (non-YouTube, non-direct) pages,
    // so the caller only needs to pass a plain page URL. Skipped when directUrl is
    // already given or the input is natively supported (YouTube). Requires RESOLVER_URL.
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
          return json(res, 502, {
            error: "Media resolution failed",
            detail: String(e.message || e),
            hint: "Pass 'directUrl' explicitly, or ensure RESOLVER_URL is reachable.",
          });
        }
      } else if (!isDirect && !isYouTube && process.env.YTDLP_ONLINE) {
        // Universal resolver via ytdlp.online (online yt-dlp wrapper). Works for any
        // site yt-dlp supports; returns a re-hosted file URL Yandex can fetch directly.
        try {
          effectiveDirect = await resolveViaYtdlpOnline(url, {
            cookie: process.env.YTDLP_ONLINE_COOKIE || "",
            timeoutMs: 45000,
          });
        } catch (e) {
          return json(res, 502, {
            error: "ytdlp.online resolution failed",
            detail: String(e.message || e),
            hint: "Pass 'directUrl' explicitly, or check YTDLP_ONLINE_COOKIE.",
          });
        }
      }
    }

    const videoData = await resolveVideoData(url, effectiveDirect);
    const client = makeClient({ sessionId: envSession, apiToken: envToken });

    if (ep === "subtitles") {
      const subs = await client.getSubtitles({
        videoData,
        requestLang: sourceLang,
      });
      return json(res, 200, {
        waiting: subs.waiting,
        subtitles: subs.subtitles,
      });
    }

    const opts = {
      videoData,
      requestLang: sourceLang,
      responseLang: targetLang,
    };
    if (effectiveDirect) {
      opts.translationHelp = [
        { target: "video_file_url", targetUrl: effectiveDirect },
      ];
    }
    if (lively) {
      opts.extraOpts = { useLivelyVoice: true };
      const h = authHeaders({ sessionId: envSession, apiToken: envToken });
      if (Object.keys(h).length) opts.headers = h;
    }

    let result;
    if (wait) {
      result = await poll(client, opts, POLL_BUDGET_MS);
    } else {
      result = await client.translateVideo(opts);
    }

    return json(res, 200, {
      status: result.translated ? "translated" : "waiting",
      audioUrl: result.url ?? null,
      translationId: result.translationId ?? null,
      remainingTime: result.remainingTime ?? null,
      raw: result,
    });
  } catch (err) {
    return json(res, 500, {
      error: String(err?.message || err),
    });
  }
}
