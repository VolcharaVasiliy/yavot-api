import { app } from "../lib/app.js";

export const maxDuration = 60;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  const body = req.method === "POST" ? await readBody(req) : null;
  const result = await app({
    method: req.method,
    pathname: (req.url || "/").split("?")[0],
    headers: req.headers,
    body,
  });

  res.statusCode = result.status;
  for (const [k, v] of Object.entries(result.headers || {})) res.setHeader(k, v);
  res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2));
}
