import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getVideoData } from "@vot.js/node/utils/videoData";
import { makeClient } from "./lib/client.js";

// Load Yandex cookies from the desktop export (kept in memory, never printed).
function loadCookies() {
  const p = path.join(os.homedir(), "Desktop", "cookies.txt");
  if (!fs.existsSync(p)) return {};
  const arr = JSON.parse(fs.readFileSync(p, "utf8"));
  const out = {};
  for (const c of arr) if (c && c.name) out[c.name] = c.value;
  return out;
}

const cookies = loadCookies();
const cookieHeader = [
  cookies["Session_id"] && `Session_id=${cookies["Session_id"]}`,
  cookies["yandexuid"] && `yandexuid=${cookies["yandexuid"]}`,
].filter(Boolean).join("; ");

const url = process.argv[2] || "https://youtu.be/dQw4w9WgXcQ";
const lively = process.argv[3] === "lively";

const client = makeClient();

const videoData = await getVideoData(url);
const opts = {
  videoData,
  requestLang: "auto",
  responseLang: "ru",
  headers: cookieHeader ? { Cookie: cookieHeader } : {},
};
if (lively) {
  opts.extraOpts = { useLivelyVoice: true };
  if (!cookieHeader) console.log("WARN: lively voice usually needs a Yandex session cookie");
}

console.log("Requesting translation for", url, lively ? "(lively)" : "");
const res = await client.translateVideo(opts);
console.log(JSON.stringify({
  translated: res.translated,
  status: res.status,
  audioUrl: res.url,
  translationId: res.translationId,
  remainingTime: res.remainingTime,
}, null, 2));
