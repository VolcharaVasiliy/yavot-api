// Minimal self-hostable media resolver for yavot-api.
//
// Speaks the contract yavot-api expects:  POST { "url": "<page url>" }
//                                      -> { "url": "<direct media url>" }
//
// It shells out to the `yt-dlp` CLI (must be installed and on PATH). This keeps
// the resolver dependency-free and easy to run on any VPS / Docker host, while
// yavot-api (e.g. on Vercel) just points RESOLVER_URL at this service.
//
// Run:   yt-dlp --version   # ensure it's installed
//        node resolver/server.mjs
// Env:   PORT (default 8787)

import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 8787);

http
  .createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Use POST" }));
    }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let pageUrl;
      try {
        pageUrl = JSON.parse(body || "{}").url;
      } catch {
        res.writeHead(400).end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      if (!pageUrl || typeof pageUrl !== "string") {
        res.writeHead(400).end(JSON.stringify({ error: "Field 'url' is required" }));
        return;
      }

      const p = spawn(
        "yt-dlp",
        ["-f", "best[ext=mp4]/best[ext=webm]/best", "-j", pageUrl],
        { maxBuffer: 1e8 },
      );
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => {
        if (code !== 0) {
          res.writeHead(502).end(
            JSON.stringify({ error: "yt-dlp failed", detail: err.slice(0, 500) }),
          );
          return;
        }
        try {
          const j = JSON.parse(out);
          const direct =
            j.url ||
            (j.requested_formats && j.requested_formats[0]?.url) ||
            (Array.isArray(j.formats) && j.formats[0]?.url);
          if (!direct) {
            res.writeHead(404).end(JSON.stringify({ error: "No media URL found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" }).end(
            JSON.stringify({ url: direct }),
          );
        } catch (e) {
          res.writeHead(500).end(JSON.stringify({ error: String(e) }));
        }
      });
    });
  })
  .listen(PORT, () => console.log(`yavot resolver listening on :${PORT} (yt-dlp CLI)`));
