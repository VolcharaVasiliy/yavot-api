// Framework-agnostic core of yavot-api.
// `app()` takes a normalized request and returns a normalized response so the same
// logic runs on Vercel (Node http), a local server, and Cloudflare Workers (Fetch API).
//
// NOTE: @vot.js/node (and its undici dependency) must never be statically imported here,
// otherwise the Cloudflare Worker bundle evaluates undici (which needs Node-only globals
// like `MessagePort`). All @vot.js/node usage is dynamic and runtime-gated below.

import { makeClient } from "./client.js";
import { resolveMediaUrl } from "./resolver.js";
import { resolveViaYtdlpOnline } from "./ytdlpOnline.js";

const DEFAULT_REQ_LANG = "auto";
const DEFAULT_RES_LANG = "ru";
const POLL_BUDGET_MS = Number(
  (typeof process !== "undefined" && process.env && process.env.POLL_BUDGET_MS) || 9000,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function debugResolver(msg) {
  try {
    console.log(`[yavot-api][resolver] ${msg}`);
  } catch {}
}

const base64 = {
  decode(s) {
    try {
      return typeof atob === "function"
        ? atob(s)
        : Buffer.from(s, "base64").toString("utf-8");
    } catch {
      return s;
    }
  },
};

let _getVideoData;
async function getVideoDataImpl() {
  if (_getVideoData) return _getVideoData;
  if (globalThis.YAVOT_RUNTIME === "worker") {
    // @vot.js/core has no getVideoData; Yandex tolerates duration 0 (it estimates itself).
    _getVideoData = async (url) => ({ url, duration: 0 });
  } else {
    const { getVideoData } = await import("@vot.js/node/utils/videoData");
    _getVideoData = getVideoData;
  }
  return _getVideoData;
}

async function resolveVideoData(url, directUrl) {
  try {
    const getVideoData = await getVideoDataImpl();
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

  const norm = (v) => {
    if (v == null || v === "") return undefined;
    const t = String(v).trim().toLowerCase();
    return t === "null" || t === "undefined" ? undefined : v;
  };
  // YANDEX_SESSION_ID может храниться в base64 (удобно задавать через vercel env,
  // т.к. значение содержит спецсимволы). Декодируем, если это валидный base64.
  let rawSession = norm(sessionId || process.env.YANDEX_SESSION_ID);
  if (rawSession) {
    try {
      const decoded = base64.decode(rawSession);
      // раскодируем только если результат — читаемая строка-сессия (начинается с "3:")
      if (decoded.startsWith("3:") || decoded.includes(":")) rawSession = decoded;
    } catch {}
  }
  const envSession = rawSession;
  const env = norm(apiToken || process.env.YANDEX_API_TOKEN);
  const resolverUrl = process.env.RESOLVER_URL || "";
  const resolverCookie = norm(process.env.YTDLP_ONLINE_COOKIE);
  // Universal resolver (ytdlp.online) is ON by default; disable with YTDLP_ONLINE=0/false.
  const resolverEnabled = !(
    process.env.YTDLP_ONLINE === "0" || process.env.YTDLP_ONLINE === "false"
  );

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
      if (!isDirect && !isYouTube) {
        if (resolverUrl) {
          try {
            effectiveDirect = await resolveMediaUrl(url, { resolverUrl });
          } catch (e) {
            if (!resolverEnabled) {
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
            debugResolver(`RESOLVER_URL failed, fallback to ytdlp.online: ${e?.message || e}`);
          }
        }
        if (!effectiveDirect && resolverEnabled) {
          try {
            effectiveDirect = await resolveViaYtdlpOnline(url, {
              cookie: resolverCookie || "",
              timeoutMs: 45000,
            });
          } catch (e) {
            const msg = String(e.message || e);
            const rateLimited =
              /daily launch limit|rate limit|too many|limit reached/i.test(msg);
            return {
              status: 502,
              headers: { ...CORS, "Content-Type": "application/json" },
              body: {
                error: rateLimited
                  ? "Лимит ytdlp.online исчерпан (анонимный доступ)"
                  : "Не удалось получить прямую ссылку на видео (ytdlp.online)",
                detail: msg.slice(0, 300),
                hint: rateLimited
                  ? "Задайте YTDLP_ONLINE_COOKIE (аккаунт ytdlp.online) либо RESOLVER_URL на свой инстанс, либо передавайте directUrl."
                  : "Pass 'directUrl' explicitly, or check YTDLP_ONLINE_COOKIE.",
              },
            };
          }
        }
      }
    }

    if (!effectiveDirect && !isDirect && !isYouTube) {
      return {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
          body: {
            error: "Не удалось разрешить источник видео",
            detail: "Ни RESOLVER_URL, ни ytdlp.online не вернули прямую ссылку.",
            hint: "Передайте directUrl (прямую ссылку на .mp4/.webm) вручную.",
          },
        };
      }

    const videoData = await resolveVideoData(url, effectiveDirect);
    const client = await makeClient({ sessionId: envSession, apiToken: env });

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
      // Живая озвучка требует авторизации Яндекса (Session_id / OAuth-токен),
      // заданной на стороне сервера. Без неё Яндекс отвечает ошибкой -> 500.
      const h = authHeaders({ sessionId: envSession, apiToken: env });
      if (!Object.keys(h).length) {
        return {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
          body: {
            error: "Живая озвучка недоступна: на сервере не задан YANDEX_SESSION_ID / YANDEX_API_TOKEN",
            detail: "Передайте обычную озвучку (lively=false) либо задайте сессию/токен Яндекса в переменных окружения yavot-api.",
            hint: "Без авторизации Яндекс не отдаёт живой голос; обычный перевод работает без неё.",
          },
        };
      }
      opts.extraOpts = { useLivelyVoice: true };
      opts.headers = h;
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
    const message = String(err?.message || err);
    // Лог на стороне сервера (serverless-логи Vercel) — видно причину 500.
    try {
      console.error(`[yavot-api][error] translate failed: ${message}`, {
        url,
        lively,
        stack: err?.stack?.slice?.(0, 500),
      });
    } catch {}
    return {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: { error: message, detail: err?.stack?.slice?.(0, 300) },
    };
  }
}

