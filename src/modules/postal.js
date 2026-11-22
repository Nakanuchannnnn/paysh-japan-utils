// Japanese postal code -> address lookup.
// Data: Japan Post KEN_ALL.CSV (official public dataset), pre-built by
// scripts/build-postal-data.py. Fully offline. The dataset ships as
// data/postal-<n>.json chunks (split for repository transfer limits);
// a single data/postal.json is used as a fallback when no chunks exist.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../../data");
const table = new Map();
const chunkFiles = readdirSync(dataDir)
  .filter((f) => /^postal-\d+\.json$/.test(f))
  .sort();
if (chunkFiles.length > 0) {
  for (const f of chunkFiles) {
    const part = JSON.parse(readFileSync(join(dataDir, f), "utf8"));
    for (const [k, v] of Object.entries(part)) table.set(k, v);
  }
} else {
  const raw = JSON.parse(readFileSync(join(dataDir, "postal.json"), "utf8"));
  for (const [k, v] of Object.entries(raw)) table.set(k, v);
}

export const routes = [
  {
    id: "postal.lookup",
    method: "GET",
    path: "/v1/postal",
    priceAtomic: "20000",
    priceUsd: 0.02,
    summary: "Look up Japanese addresses by 7-digit postal code",
    query: {
      code: { type: "string", required: true, description: "7-digit Japanese postal code; hyphen optional (e.g. 100-0001 or 1000001)", example: "100-0001" },
    },
    handler({ query }) {
      const code = String(query.get("code") || "").replace(/[-\s]/g, "");
      if (!/^\d{7}$/.test(code)) {
        return { status: 400, json: { error: "code must be exactly 7 digits (hyphen optional)" } };
      }
      const entries = table.get(code);
      if (!entries) {
        return { status: 404, json: { error: `postal code ${code} not found`, postal_code: `${code.slice(0, 3)}-${code.slice(3)}` } };
      }
      return {
        json: {
          postal_code: `${code.slice(0, 3)}-${code.slice(3)}`,
          addresses: entries.map(([p, c, t, pk, ck, tk]) => ({
            prefecture: p,
            city: c,
            town: t,
            prefecture_kana: pk,
            city_kana: ck,
            town_kana: tk,
          })),
          source: "Japan Post KEN_ALL (public dataset)",
        },
      };
    },
  },
];
