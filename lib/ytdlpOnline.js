// Resolver backed by https://ytdlp.online (online yt-dlp wrapper).
// Returns a re-hosted media URL on ytdlp.online that Yandex can fetch & translate.
//
// Reverse-engineered from a captured browser session:
//   GET https://ytdlp.online/api/v1/stream?command=<yt-dlp args> <url>&job_id=<uuid>&source=index
//   -> Server-Sent Events; each event's data is the console output encoded as
//      comma-separated decimal ASCII codes (e.g. "100,97,116,97,58,32" === "data: ").
//   -> On success the stream contains a link: /api/v1/file/<name>.mp4

const BASE = "https://ytdlp.online";

function decodeStream(raw) {
  return raw
    .split(",")
    .map((t) => {
      t = t.trim();
      return /^\d+$/.test(t) ? String.fromCharCode(+t) : "";
    })
    .join("");
}

export async function resolveViaYtdlpOnline(pageUrl, { cookie = "", timeoutMs = 60000 } = {}) {
  const command = `-f bestvideo+bestaudio/best ${pageUrl}`;
  const jobId =
    globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  const url = `${BASE}/api/v1/stream?command=${encodeURIComponent(command)}&job_id=${jobId}&source=index`;

  const headers = {
    accept: "text/event-stream",
    referer: `${BASE}/`,
    "sec-fetch-site": "same-origin",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0 Safari/537.36",
  };
  if (cookie) headers.cookie = cookie;

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  let raw = "";
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok && res.status !== 200) {
      throw new Error(`ytdlp.online responded ${res.status}`);
    }
    for await (const chunk of res.body) {
      raw += chunk.toString();
    }
  } finally {
    clearTimeout(to);
  }

  const decoded = decodeStream(raw);
  const m = decoded.match(/\/api\/v1\/file\/[^\s"<\x00]+/);
  if (!m) {
    const err = decoded.match(/ERROR:[^\n]+/);
    throw new Error(err ? err[0].slice(0, 200) : "ytdlp.online returned no file URL");
  }
  return `${BASE}${m[0]}`;
}
