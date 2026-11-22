// Web utilities: OGP/metadata extraction and DNS lookup.
// These need outbound network at runtime. The OGP fetcher has an SSRF guard:
// non-http(s) schemes are rejected and, unless PAYSH_ALLOW_PRIVATE_URLS=1
// (local tests only), hosts resolving to private/loopback/link-local
// addresses are refused.
import dns from "node:dns";
import { config } from "../config.js";

const resolver = new dns.promises.Resolver();

function ipIsPrivate(ip) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd") || v === "::";
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return true;
  const [a, b] = parts;
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

async function assertHostAllowed(hostname) {
  if (config.allowPrivateUrls) return;
  const lowered = hostname.toLowerCase();
  if (lowered === "localhost" || lowered.endsWith(".local")) {
    throw new Error("private/loopback hosts are not allowed");
  }
  const records = await dns.promises.lookup(hostname, { all: true }).catch(() => []);
  for (const r of records) {
    if (ipIsPrivate(r.address)) throw new Error("host resolves to a private/loopback address");
  }
}

function extractMeta(html, finalUrl) {
  const head = html.slice(0, 512 * 1024);
  const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const metas = {};
  const metaRe = /<meta\s+[^>]*>/gi;
  let tag;
  while ((tag = metaRe.exec(head)) !== null) {
    const t = tag[0];
    const keyM = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(t);
    const contentM = /content\s*=\s*["']([^"']*)["']/i.exec(t);
    if (keyM && contentM) {
      const key = keyM[1].toLowerCase();
      if (!(key in metas)) metas[key] = contentM[1].trim();
    }
  }
  const pick = (...keys) => {
    for (const k of keys) if (metas[k]) return metas[k];
    return null;
  };
  const decode = (s) =>
    s === null ? null : s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return {
    url: finalUrl,
    title: titleM ? decode(titleM[1].trim()) : pick("og:title", "twitter:title"),
    description: decode(pick("og:description", "description", "twitter:description")),
    image: pick("og:image", "twitter:image"),
    site_name: pick("og:site_name"),
    type: pick("og:type"),
    twitter_card: pick("twitter:card"),
  };
}

export async function fetchOgp(urlStr, fetchImpl = fetch) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http/https URLs are supported");
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    await assertHostAllowed(current.hostname);
    const resp = await fetchImpl(current.toString(), {
      redirect: "manual",
      headers: { "user-agent": "paysh-japan-utils/0.1 (+metadata fetcher)", accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      if (hop === 3) throw new Error("too many redirects");
      current = new URL(resp.headers.get("location"), current);
      if (current.protocol !== "http:" && current.protocol !== "https:") throw new Error("redirect to non-http(s) URL");
      continue;
    }
    if (!resp.ok) throw new Error(`upstream HTTP ${resp.status}`);
    const html = await resp.text();
    return extractMeta(html, current.toString());
  }
  throw new Error("unreachable");
}

const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA", "SRV"];
export async function dnsLookup(name, type, res = resolver) {
  const t = String(type || "A").toUpperCase();
  if (!DNS_TYPES.includes(t)) throw new Error(`type must be one of ${DNS_TYPES.join(", ")}`);
  try {
    let records;
    switch (t) {
      case "A": records = await res.resolve4(name); break;
      case "AAAA": records = await res.resolve6(name); break;
      case "CNAME": records = await res.resolveCname(name); break;
      case "MX": records = await res.resolveMx(name); break;
      case "TXT": records = (await res.resolveTxt(name)).map((parts) => parts.join("")); break;
      case "NS": records = await res.resolveNs(name); break;
      case "CAA": records = await res.resolveCaa(name); break;
      case "SRV": records = await res.resolveSrv(name); break;
    }
    return { name, type: t, records };
  } catch (e) {
    if (e && (e.code === "ENOTFOUND" || e.code === "ENODATA")) {
      return { name, type: t, records: [], note: e.code };
    }
    throw e;
  }
}

function badRequest(message) {
  return { status: 400, json: { error: message } };
}
export const routes = [
  {
    id: "web.ogp",
    method: "POST",
    path: "/v1/web/ogp",
    priceAtomic: "30000",
    priceUsd: 0.03,
    summary: "Fetch a web page and extract Open Graph / Twitter Card / title metadata",
    body: {
      required: ["url"],
      properties: {
        url: { type: "string", description: "http(s) URL of the page to inspect", example: "https://example.com" },
      },
    },
    async handler({ body }) {
      if (!body || typeof body.url !== "string") return badRequest("body.url (string) is required");
      try {
        const meta = await fetchOgp(body.url);
        return { json: meta };
      } catch (e) {
        return { status: 502, json: { error: `fetch failed: ${e.message}` } };
      }
    },
  },
  {
    id: "web.dns",
    method: "POST",
    path: "/v1/web/dns",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Look up DNS records (A, AAAA, CNAME, MX, TXT, NS, CAA, SRV) for a hostname",
    body: {
      required: ["name"],
      properties: {
        name: { type: "string", description: "Hostname to resolve", example: "example.com" },
        type: { type: "string", description: "Record type (default A)", example: "MX" },
      },
    },
    async handler({ body }) {
      if (!body || typeof body.name !== "string" || body.name.length === 0) return badRequest("body.name (string) is required");
      try {
        return { json: await dnsLookup(body.name, body.type || "A") };
      } catch (e) {
        return badRequest(e.message);
      }
    },
  },
];
