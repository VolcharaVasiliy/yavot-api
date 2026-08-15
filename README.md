# yavot-api

> Universal proxy API for **Yandex VOT** (Video OverTranslation) — free neural video
> translation / text-to-speech — built on top of [`@vot.js/node`](https://github.com/FOSWLY/vot.js).

This is a small, dependency-light HTTP API that wraps Yandex's internal video-translation
service so you can drop it into **any app, script, or browser extension** with a single
`POST` request. It handles the protobuf encoding, HMAC request signing, session creation,
and the polling/audio-upload dance that Yandex requires — all behind a clean JSON interface.

- Translate any **YouTube** video (and many other sites) to a dubbed audio track.
- Optional **"lively voice"** mode (neural voice cloning) — requires a logged-in Yandex account.
- Optional **HTTP(S) proxy** support (e.g. Clash) for routing egress.
- **CORS-open** — callable directly from the browser.
- **Vercel-ready** — deploy as a serverless function in seconds.

---

## ⚠️ Rules of use

This project is provided **for educational and research purposes only**. By using it you agree:

1. **Not affiliated with Yandex.** This is an unofficial, reverse-engineered client. All
   rights to the original software belong to their respective owners.
2. **Respect Yandex Terms of Service.** Do not use this for commercial purposes, spam, or
   anything that violates Yandex's terms. Obtain proper permission for any production use.
3. **Self-limit / be a good citizen.** Yandex may rate-limit or block abusive traffic. Add
   your own throttling, cache results, and don't hammer the endpoint.
4. **Use at your own risk.** No warranty, express or implied. Translations depend entirely on
   Yandex's backend, which can change or block access at any time (including per-IP or
   per-account limits).
5. **Protect credentials.** If you enable "lively voice", keep your `Session_id` / OAuth token
   secret. Never commit them. Prefer environment variables.
6. **Don't harm others.** Don't expose an open proxy that lets third parties burn *your*
   account quota or IP reputation without their knowledge.

The maintainers are not responsible for any issues arising from the use of this software.

---

## How it works

```
client ──POST /translate──▶ yavot-api ──protobuf+HMAC──▶ api.browser.yandex.ru
                                │                            │
                                │  poll until FINISHED       │ (Yandex translates,
                                ◀───────────────────────────│  stores audio on S3)
                          { audioUrl, status }
```

1. `yavot-api` opens a signed session (`/session/create`, HMAC-SHA256).
2. It sends a protobuf `VideoTranslationRequest` for the URL.
3. Yandex either returns a finished dubbing URL, or `WAITING` with a `remainingTime`
   (the API returns that to you — **you poll** until it's ready).
4. For brand-new YouTube videos Yandex may ask the client to upload the source audio; the
   library handles this automatically.

> **Why a proxy?** Yandex's balancer rejects requests that carry the browser-specific
> `sec-fetch-mode` header. The API strips it (via `VOTAgent`/`VOTProxyAgent`) so the request
> is accepted. A proxy is optional and only needed if your egress IP is restricted.

---

## Requirements

- **Node.js 18+** (developed on Node 24).
- For **"lively voice"** (voice cloning): a Yandex account session. You can take it from
  <https://id.yandex.ru/> — log in there, then export the `Session_id` cookie from your
  browser (DevTools → Application → Cookies, or a cookie-export extension) or grab an OAuth
  token from <https://oauth.yandex.ru>.

---

## Installation

```bash
git clone <your-fork>
cd yavot-api
npm install
```

---

## Local usage

```bash
npm start                 # serves http://localhost:3000
```

Quick manual test (auto-loads `Session_id` from a `cookies.txt` on your Desktop if present):

```bash
node test-translate.mjs "https://youtu.be/VIDEO_ID"            # classic voice
node test-translate.mjs "https://youtu.be/VIDEO_ID" lively     # lively/clone voice
```

### Environment variables (`.env`)

| Variable             | Default                       | Description                                                        |
| -------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `YAVOT_PROXY`        | _(unset → direct)_            | HTTP(S) proxy URL, e.g. `http://127.0.0.1:7897`. Set to `off` to force direct. |
| `YANDEX_SESSION_ID`  | _(empty)_                     | `Session_id` cookie value (take it from <https://id.yandex.ru/>) → enables lively voice. |
| `YANDEX_API_TOKEN`   | _(empty)_                     | Yandex OAuth token → enables lively voice (alternative to cookie). |
| `POLL_BUDGET_MS`     | `9000`                        | Max ms the API blocks while polling inside a single request.       |
| `RESOLVER_URL`       | _(empty)_                     | Optional media resolver for arbitrary page URLs (see below).       |
| `YTDLP_ONLINE`       | _(empty)_                     | Enable the ytdlp.online universal resolver (any site yt-dlp supports). |
| `YTDLP_ONLINE_COOKIE`| _(empty)_                     | Optional `ytdlp.online` session cookie (`_sid=...`).              |

---

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/VolcharaVasiliy/yavot-api&project-name=yavot-api&env=YANDEX_SESSION_ID,YTDLP_ONLINE,YTDLP_ONLINE_COOKIE&envDescription=Optional%20Yandex%20session%20(for%20lively%20voice)%20and%20ytdlp.online%20resolver%20cookie)

[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy%20to-Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://deploy.workers.cloudflare.com/?url=https://github.com/VolcharaVasiliy/yavot-api)

### Vercel

```bash
vercel deploy --prod --yes
```

After deploy, set env vars in the Vercel dashboard (`YANDEX_SESSION_ID`, `YTDLP_ONLINE`, …)
if you need them. Preview deployments are Vercel-auth protected; production is public.

### Cloudflare Workers

This repo ships a Cloudflare Worker (`worker.mjs` + `wrangler.toml`, Node.js compat) that
reuses the same core as the Vercel deployment. Use the one-click button above, or:

```bash
npm install
npx wrangler deploy
```

Set secrets (optional): `npx wrangler secret put YANDEX_SESSION_ID` and
`npx wrangler secret put YTDLP_ONLINE_COOKIE`. Enable the universal resolver by adding
`YTDLP_ONLINE = "1"` under `[vars]` in `wrangler.toml` (or as a secret).

> **One-click deploy note:** the Cloudflare deploy page may show a required
> `YANDEX_API_TOKEN` field. You don't need it — just type `null` (the literal word) and
> finish. The code treats `null`/empty as "no token", so translation still works without
> authentication (lively voice stays off until you set a real token or cookie).

---

## API reference

Base URL: `https://<your-deployment>/`

### `GET /`

Returns a small service descriptor.

### `POST /translate`

Request body:

```json
{
  "url": "https://youtu.be/dQw4w9WgXcQ",
  "sourceLang": "auto",
  "targetLang": "ru",
  "lively": false,
  "directUrl": null,
  "sessionId": null,
  "apiToken": null,
  "wait": false
}
```

| Field        | Type    | Default  | Notes                                                                 |
| ------------ | ------- | -------- | --------------------------------------------------------------------- |
| `url`        | string  | —        | **Required.** YouTube link or any supported site URL.                 |
| `sourceLang` | string  | `"auto"` | Source language code (`auto`, `en`, `ru`, `zh`, …).                   |
| `targetLang` | string  | `"ru"`   | Target language (`ru`, `en`, `kk`).                                   |
| `lively`     | boolean | `false`  | Use neural "lively" (cloned) voices — requires Yandex auth.           |
| `directUrl`  | string  | `null`   | Direct `.mp4`/`.webm` link for arbitrary videos (see below).         |
| `sessionId`  | string  | `null`   | Override Yandex `Session_id` per request.                            |
| `apiToken`   | string  | `null`   | Override Yandex OAuth token per request.                            |
| `wait`       | boolean | `false`  | Block up to `POLL_BUDGET_MS` polling for a result (serverless-safe). |

Response (finished):

```json
{
  "status": "translated",
  "audioUrl": "https://vtrans.s3-private.mds.yandex.net/tts/prod/....mp3?X-Amz-...",
  "translationId": "425832160",
  "remainingTime": -1
}
```

Response (still working — **poll again**):

```json
{ "status": "waiting", "audioUrl": null, "translationId": "425832160", "remainingTime": 51 }
```

> **Polling model.** Translations take 30–90s. Serverless platforms (Vercel) time out at
> ~10s, so a single call cannot block until completion. The API returns `waiting` +
> `remainingTime`; your client should re-`POST /translate` (same `url`) after that delay
> until `status: "translated"`. Use `wait: true` only for short jobs.

### `POST /subtitles`

```json
{ "url": "https://youtu.be/dQw4w9WgXcQ", "sourceLang": "ru" }
```

Returns `{ waiting, subtitles: [{ language, url, translatedLanguage, translatedUrl }, …] }`.

### Example

```bash
curl -X POST https://your-app.vercel.app/translate \
  -H 'content-type: application/json' \
  -d '{"url":"https://youtu.be/dQw4w9WgXcQ","wait":false}'
```

---

## Translating **any** video (not just YouTube)

Yandex translates a direct media file, not an HTML page. The API already resolves direct
links for:

- **YouTube** — fully automatic from the share URL.
- **Hundreds of known sites** — resolved automatically by the library's site helpers.

For everything else, pass the direct media URL:

```json
{
  "url": "https://example.com/page",
  "directUrl": "https://example.com/path/video.mp4"
}
```

The `directUrl` is sent as `translationHelp`, so Yandex fetches and translates that file.
Once translated, the result is cached and later reachable even without `directUrl`.

**Auto-extraction for arbitrary pages.** Set `RESOLVER_URL` to a media-resolver service and
the API will automatically resolve a direct media URL from *any* page URL — no `directUrl`
needed. The resolver contract is simple: `POST { "url": "<page>" }` → `{ "url": "<media>" }`
(Cobalt-compatible). A ready-to-self-host resolver is included:

```bash
# on any VPS / Docker host with yt-dlp installed:
node resolver/server.mjs          # listens on :8787
# then on the API side:
RESOLVER_URL=http://<your-host>:8787
```

This keeps `yavot-api` itself thin (and serverless-friendly) while offloading the heavy
`yt-dlp` work to a separate host you control.

**Universal resolver via ytdlp.online (zero-infra).** Set `YTDLP_ONLINE=1` to let the API
resolve *any* site that [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports — with no VPS and
no binary. It calls `https://ytdlp.online/api/v1/stream`, decodes the SSE console output, and
returns a **re-hosted file URL** on `ytdlp.online` (publicly fetchable, so Yandex can grab it
directly — no IP/geo locks). Optional: `YTDLP_ONLINE_COOKIE` (`_sid=...`) if the service
requires a session. This is the recommended option for full automation from a serverless
deployment (e.g. Vercel), since Vercel can't run the `yt-dlp` binary itself.

**Natively supported sites:** ~80 platforms (YouTube, Vimeo, Twitch, VK, OK.ru, Bilibili,
Dailymotion, Rutube, TikTok/Douyin, Rumble, Facebook, Twitter/X, IMDB, Coursera, Udemy,
LinkedIn Learning, and many more) are resolved automatically from a plain page URL — see
[SUPPORTED_SITES.md](./SUPPORTED_SITES.md) for the full list. With `YTDLP_ONLINE=1`, every
other yt-dlp-compatible site is translatable from a bare page URL as well.

---

## Project layout

```
api/index.js        # Vercel serverless handler (the API)
lib/client.js       # Yandex client factory (proxy + dispatcher setup)
server.mjs          # local dev server
test-translate.mjs  # manual end-to-end test
```

---

## Credits

Built on [`@vot.js/node`](https://github.com/FOSWLY/vot.js) by the FOSWLY team — an
unofficial Yandex VOT client. This repo is a thin, deployable wrapper around it.

## License

This project is for research/educational use (see **Rules of use**). Check the license of
the underlying [`vot.js`](https://github.com/FOSWLY/vot.js) for its terms.
