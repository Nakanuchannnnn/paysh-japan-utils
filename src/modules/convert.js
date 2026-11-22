// Conversion utilities: CSV<->JSON, unit conversion, FX conversion
// (ECB daily reference rates bundled in data/fx.json).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, "../../data/fx.json"), "utf8"));

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

// ---------- Units ----------
// factor = multiplier to the category base unit.
const UNITS = {
  length: { base: "m", units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 } },
  mass: { base: "kg", units: { g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237 } },
  volume: { base: "L", units: { ml: 0.001, l: 1, gal_us: 3.785411784, cup_jp: 0.2 } },
  area: { base: "m2", units: { m2: 1, km2: 1e6, ha: 1e4, tsubo: 3.305785123966942, acre: 4046.8564224, ft2: 0.09290304 } },
  speed: { base: "m/s", units: { "m/s": 1, kmh: 1 / 3.6, mph: 0.44704, knot: 0.514444 } },
  data: { base: "byte", units: { byte: 1, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1048576, gib: 1073741824, tib: 1099511627776 } },
};
function convertTemperature(value, from, to) {
  let c;
  if (from === "c") c = value;
  else if (from === "f") c = (value - 32) * 5 / 9;
  else if (from === "k") c = value - 273.15;
  else return null;
  if (to === "c") return c;
  if (to === "f") return c * 9 / 5 + 32;
  if (to === "k") return c + 273.15;
  return null;
}
function findCategory(unit) {
  if (["c", "f", "k"].includes(unit)) return "temperature";
  for (const [cat, def] of Object.entries(UNITS)) {
    if (unit in def.units) return cat;
  }
  return null;
}

function badRequest(message) {
  return { status: 400, json: { error: message } };
}

export const routes = [
  {
    id: "convert.csvToJson",
    method: "POST",
    path: "/v1/convert/csv-to-json",
    priceAtomic: "20000",
    priceUsd: 0.02,
    summary: "Convert CSV text to a JSON array of objects (first row = header by default)",
    body: {
      required: ["csv"],
      properties: {
        csv: { type: "string", description: "CSV text (RFC 4180 quoting supported)", example: "name,age\nAlice,30\nBob,25" },
        header: { type: "boolean", description: "Treat first row as header (default true). If false, returns arrays.", example: true },
      },
    },
    handler({ body }) {
      if (!body || typeof body.csv !== "string") return badRequest("body.csv (string) is required");
      if (body.csv.length > 1_000_000) return badRequest("csv too large (max 1,000,000 chars)");
      const rows = parseCsv(body.csv);
      if (rows.length === 0) return { json: { rows: [] } };
      if (body.header === false) return { json: { rows } };
      const head = rows[0];
      const objects = rows.slice(1).map((r) => {
        const o = {};
        head.forEach((h, i) => { o[h] = i < r.length ? r[i] : ""; });
        return o;
      });
      return { json: { rows: objects } };
    },
  },
  {
    id: "convert.jsonToCsv",
    method: "POST",
    path: "/v1/convert/json-to-csv",
    priceAtomic: "20000",
    priceUsd: 0.02,
    summary: "Convert a JSON array (of objects or arrays) to CSV text",
    body: {
      required: ["rows"],
      properties: {
        rows: { type: "array", description: "Array of objects (columns = union of keys) or array of arrays", example: [{ name: "Alice", age: 30 }] },
      },
    },
    handler({ body }) {
      if (!body || !Array.isArray(body.rows)) return badRequest("body.rows (array) is required");
      if (body.rows.length === 0) return { json: { csv: "" } };
      if (Array.isArray(body.rows[0])) return { json: { csv: toCsv(body.rows) } };
      const cols = [];
      for (const r of body.rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
      const table = [cols, ...body.rows.map((r) => cols.map((c) => r[c]))];
      return { json: { csv: toCsv(table) } };
    },
  },
  {
    id: "convert.units",
    method: "POST",
    path: "/v1/convert/units",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Convert between units (length, mass, volume, area incl. tsubo, speed, data, temperature)",
    body: {
      required: ["value", "from", "to"],
      properties: {
        value: { type: "number", description: "Numeric value to convert", example: 10 },
        from: { type: "string", description: "Source unit: mm cm m km in ft yd mi | g kg t oz lb | ml l gal_us cup_jp | m2 km2 ha tsubo acre ft2 | m/s kmh mph knot | byte kb mb gb tb kib mib gib tib | c f k", example: "km" },
        to: { type: "string", description: "Target unit (same category)", example: "mi" },
      },
    },
    handler({ body }) {
      const { value, from, to } = body || {};
      if (typeof value !== "number" || !Number.isFinite(value)) return badRequest("body.value must be a finite number");
      const fromU = String(from || "").toLowerCase();
      const toU = String(to || "").toLowerCase();
      const catFrom = findCategory(fromU);
      const catTo = findCategory(toU);
      if (!catFrom) return badRequest(`unknown unit: ${from}`);
      if (!catTo) return badRequest(`unknown unit: ${to}`);
      if (catFrom !== catTo) return badRequest(`category mismatch: ${from} is ${catFrom}, ${to} is ${catTo}`);
      let result;
      if (catFrom === "temperature") result = convertTemperature(value, fromU, toU);
      else result = (value * UNITS[catFrom].units[fromU]) / UNITS[catFrom].units[toU];
      return { json: { value, from: fromU, to: toU, category: catFrom, result } };
    },
  },
  {
    id: "convert.fx",
    method: "POST",
    path: "/v1/convert/fx",
    priceAtomic: "20000",
    priceUsd: 0.02,
    summary: "Convert currencies using ECB daily reference rates (bundled snapshot, updated at deploy time)",
    body: {
      required: ["amount", "from", "to"],
      properties: {
        amount: { type: "number", description: "Amount to convert", example: 100 },
        from: { type: "string", description: "Source ISO 4217 currency code", example: "USD" },
        to: { type: "string", description: "Target ISO 4217 currency code", example: "JPY" },
      },
    },
    handler({ body }) {
      const { amount, from, to } = body || {};
      if (typeof amount !== "number" || !Number.isFinite(amount)) return badRequest("body.amount must be a finite number");
      const f = String(from || "").toUpperCase();
      const t = String(to || "").toUpperCase();
      if (!(f in fx.rates)) return badRequest(`unsupported currency: ${from}`);
      if (!(t in fx.rates)) return badRequest(`unsupported currency: ${to}`);
      const rate = fx.rates[t] / fx.rates[f];
      return {
        json: {
          amount, from: f, to: t, rate, result: amount * rate,
          as_of: fx.as_of,
          source: fx.source,
          note: "Daily reference rates (not real-time market rates). Snapshot bundled with the service.",
        },
      };
    },
  },
];
