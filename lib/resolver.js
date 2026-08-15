// Pluggable media resolver.
// Given a page/video URL, returns a direct .mp4/.webm media URL.
// Compatible with the Cobalt API contract (`{ "status": "success", "url": ... }`)
// and any service that simply returns `{ "url": "..." }`.
// Point RESOLVER_URL at your own self-hosted instance (see resolver/server.mjs).

export async function resolveMediaUrl(pageUrl, { resolverUrl, timeoutMs = 20000 } = {}) {
  if (!resolverUrl) return null;

  const res = await fetch(resolverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url: pageUrl }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`Resolver responded ${res.status}`);
  }

  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Resolver returned non-JSON body");

  // Generic / self-hosted resolver: { url: "..." }
  let direct = typeof data.url === "string" ? data.url : null;

  // Cobalt-style: { status: "success", url: "..." }
  if (!direct && data.status === "success" && typeof data.url === "string") {
    direct = data.url;
  }

  // Cobalt picker: { status: "picker", picker: [{ url }] }
  if (!direct && data.status === "picker" && Array.isArray(data.picker)) {
    const first = data.picker.find((p) => typeof p?.url === "string");
    if (first) direct = first.url;
  }

  if (!direct) throw new Error("Resolver returned no usable media URL");
  return direct;
}
