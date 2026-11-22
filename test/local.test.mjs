// Local verification suite. Spawns the real server as a child process with
// dev-payment mode on (PAYSH_DEV_ACCEPT_ANY_PAYMENT=1) and private URLs
// allowed for the OGP fixture. Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodeQr } from "../src/modules/qr.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 14099;
const BASE = `http://127.0.0.1:${PORT}`;
const PAY_TO = "HEFgZ9L5S9U9ScwfFw67Y3AivGQXSNhYZFFRQuACegsK";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

let server;
let fixture;

function paymentHeader() {
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: "solana",
    payload: { transaction: "A".repeat(120) },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}
async function paid(path, options = {}) {
  const headers = { ...(options.headers || {}), "x-payment": paymentHeader() };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const resp = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw (svg) */ }
  return { status: resp.status, headers: resp.headers, json, text };
}
const paidGet = (path) => paid(path);
const paidPost = (path, obj) => paid(path, { method: "POST", body: JSON.stringify(obj) });

before(async () => {
  server = spawn("node", [join(here, "../src/server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      PAYSH_DEV_ACCEPT_ANY_PAYMENT: "1",
      PAYSH_ALLOW_PRIVATE_URLS: "1",
    },
    stdio: "pipe",
  });
  // Local fixture page for the OGP test.
  fixture = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><head><title>Fixture Title</title>
      <meta property="og:title" content="OG Fixture">
      <meta property="og:description" content="A fixture description">
      <meta property="og:image" content="https://example.com/img.png">
      <meta property="og:site_name" content="FixtureSite">
      </head><body>hi</body></html>`);
  });
  await new Promise((r) => fixture.listen(14100, "127.0.0.1", r));
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});
after(() => {
  server.kill();
  fixture.close();
});

// ---------- Payment gate ----------
test("health and openapi are free", async () => {
  const h = await fetch(`${BASE}/health`);
  assert.equal(h.status, 200);
  const spec = await (await fetch(`${BASE}/openapi.json`)).json();
  assert.equal(Object.keys(spec.paths).length, 18);
});

test("unpaid request returns a valid Solana x402 challenge", async () => {
  const resp = await fetch(`${BASE}/v1/postal?code=1000001`);
  assert.equal(resp.status, 402);
  const body = await resp.json();
  assert.equal(body.x402Version, 1);
  const req0 = body.accepts[0];
  assert.equal(req0.scheme, "exact");
  assert.equal(req0.network, "solana");
  assert.equal(req0.payTo, PAY_TO);
  assert.equal(req0.asset, USDC_MINT);
  assert.equal(req0.maxAmountRequired, "20000"); // $0.02
  const headerPayload = JSON.parse(Buffer.from(resp.headers.get("x-payment-required"), "base64").toString("utf8"));
  assert.equal(headerPayload.accepts[0].payTo, PAY_TO);
});

test("unpaid POST also returns 402 with the route price", async () => {
  const resp = await fetch(`${BASE}/v1/web/ogp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(resp.status, 402);
  const body = await resp.json();
  assert.equal(body.accepts[0].maxAmountRequired, "30000"); // $0.03
});

test("malformed X-PAYMENT is rejected with 402", async () => {
  const resp = await fetch(`${BASE}/v1/postal?code=1000001`, { headers: { "x-payment": "not-base64-json!!!" } });
  assert.equal(resp.status, 402);
});

// ---------- Postal ----------
test("postal lookup returns the correct address", async () => {
  const { status, json } = await paidGet("/v1/postal?code=1000001");
  assert.equal(status, 200);
  assert.equal(json.postal_code, "100-0001");
  assert.equal(json.addresses[0].prefecture, "東京都");
  assert.equal(json.addresses[0].city, "千代田区");
  assert.equal(json.addresses[0].town, "千代田");
  const hyphen = await paidGet("/v1/postal?code=100-0002");
  assert.equal(hyphen.json.addresses[0].town, "皇居外苑");
});
test("postal lookup errors", async () => {
  assert.equal((await paidGet("/v1/postal?code=9999999")).status, 404);
  assert.equal((await paidGet("/v1/postal?code=123")).status, 400);
});

// ---------- Calendar ----------
test("JP holidays 2026 include citizens' holiday and substitute holiday", async () => {
  const { json } = await paidGet("/v1/holidays?year=2026&country=JP");
  const byDate = Object.fromEntries(json.holidays.map((h) => [h.date, h.name]));
  assert.equal(byDate["2026-01-01"], "元日");
  assert.equal(byDate["2026-09-22"], "国民の休日");
  assert.equal(byDate["2026-05-06"], "振替休日");
  assert.equal(byDate["2026-11-23"], "勤労感謝の日");
});
test("US/DE/GB holidays spot checks", async () => {
  const us = await paidGet("/v1/holidays?year=2026&country=US");
  const usByDate = Object.fromEntries(us.json.holidays.map((h) => [h.date, h.name]));
  assert.equal(usByDate["2026-11-26"], "Thanksgiving Day");
  const de = await paidGet("/v1/holidays?year=2026&country=DE");
  const deByDate = Object.fromEntries(de.json.holidays.map((h) => [h.date, h.name]));
  assert.equal(deByDate["2026-04-03"], "Karfreitag"); // Easter 2026 = Apr 5
  assert.equal(deByDate["2026-04-06"], "Ostermontag");
  const gb = await paidGet("/v1/holidays?year=2026&country=GB");
  const gbByDate = Object.fromEntries(gb.json.holidays.map((h) => [h.date, h.name]));
  assert.equal(gbByDate["2026-12-28"], "Boxing Day (substitute day)"); // Dec 26 2026 is Saturday
});
test("business-day checks", async () => {
  const sun = await paidGet("/v1/business-day?date=2026-11-22&country=JP");
  assert.equal(sun.json.is_business_day, false); // Sunday
  const hol = await paidGet("/v1/business-day?date=2026-11-23&country=JP");
  assert.equal(hol.json.is_business_day, false);
  assert.equal(hol.json.holiday.name, "勤労感謝の日");
  const tue = await paidGet("/v1/business-day?date=2026-11-24&country=JP");
  assert.equal(tue.json.is_business_day, true);
});
test("add business days skips weekend and holiday", async () => {
  const { json } = await paidGet("/v1/business-days/add?date=2026-11-20&days=1&country=JP");
  assert.equal(json.result, "2026-11-24"); // Fri +1 business day -> Tue (Mon is a holiday)
});

// ---------- Wareki ----------
test("wareki conversions", async () => {
  const reiwa = await paidGet("/v1/wareki?date=2019-05-01");
  assert.equal(reiwa.json.label, "令和元年");
  const showa = await paidGet("/v1/wareki?date=1989-01-07");
  assert.equal(showa.json.label, "昭和64年");
  const heisei = await paidGet("/v1/wareki?date=1989-01-08");
  assert.equal(heisei.json.label, "平成元年");
  const back = await paidGet("/v1/seireki?era=令和&year=8&month=11&day=22");
  assert.equal(back.json.date, "2026-11-22");
  const invalid = await paidGet("/v1/seireki?era=平成&year=31&month=5&day=1");
  assert.equal(invalid.status, 400); // Heisei 31 ended on 2019-04-30
});

// ---------- Text ----------
test("romaji conversion both directions", async () => {
  const a = await paidPost("/v1/text/romaji", { text: "とうきょう" });
  assert.equal(a.json.result, "toukyou");
  const b = await paidPost("/v1/text/romaji", { text: "がっこう" });
  assert.equal(b.json.result, "gakkou");
  const c = await paidPost("/v1/text/romaji", { text: "しんぶん" });
  assert.equal(c.json.result, "shimbun");
  const d = await paidPost("/v1/text/romaji", { text: "toukyou", direction: "to-kana" });
  assert.equal(d.json.result, "とうきょう");
  const e = await paidPost("/v1/text/romaji", { text: "gakkou", direction: "to-kana" });
  assert.equal(e.json.result, "がっこう");
});
test("slugify", async () => {
  const a = await paidPost("/v1/text/slug", { text: "すしと ラーメン" });
  assert.equal(a.json.slug, "sushito-raamen");
  const u = await paidPost("/v1/text/slug", { text: "東京 スカイツリー", unicode: true });
  assert.equal(u.json.slug, "東京-スカイツリー");
});
test("width normalization", async () => {
  const h = await paidPost("/v1/text/normalize", { text: "ＡＢＣ１２３ｶﾀｶﾅ", mode: "halfwidth" });
  assert.equal(h.json.result, "ABC123カタカナ");
  const f = await paidPost("/v1/text/normalize", { text: "ABC123", mode: "fullwidth" });
  assert.equal(f.json.result, "ＡＢＣ１２３");
});

// ---------- Datetime ----------
test("timezone conversion JST -> EST", async () => {
  const { json } = await paidPost("/v1/time/convert", { datetime: "2026-11-22 22:00:00", from_tz: "Asia/Tokyo", to_tz: "America/New_York" });
  assert.equal(json.utc, "2026-11-22T13:00:00.000Z");
  assert.ok(json.to.local.startsWith("2026-11-22T08:00:00"));
  assert.equal(json.to.utc_offset, "-05:00");
});
test("unix timestamp round trip", async () => {
  const a = await paidPost("/v1/time/unix", { input: "2026-11-22T13:00:00.000Z" });
  const b = await paidPost("/v1/time/unix", { input: a.json.unix_seconds });
  assert.equal(b.json.iso8601, "2026-11-22T13:00:00.000Z");
});

// ---------- Convert ----------
test("csv <-> json", async () => {
  const a = await paidPost("/v1/convert/csv-to-json", { csv: 'name,note\nAlice,"likes, commas"\nBob,plain' });
  assert.deepEqual(a.json.rows, [
    { name: "Alice", note: "likes, commas" },
    { name: "Bob", note: "plain" },
  ]);
  const b = await paidPost("/v1/convert/json-to-csv", { rows: [{ a: 1, b: "x,y" }] });
  assert.ok(b.json.csv.includes('"x,y"'));
});
test("unit conversion", async () => {
  const km = await paidPost("/v1/convert/units", { value: 10, from: "km", to: "mi" });
  assert.ok(Math.abs(km.json.result - 6.213712) < 1e-5);
  const temp = await paidPost("/v1/convert/units", { value: 100, from: "c", to: "f" });
  assert.equal(temp.json.result, 212);
  const tsubo = await paidPost("/v1/convert/units", { value: 1, from: "tsubo", to: "m2" });
  assert.ok(Math.abs(tsubo.json.result - 3.305785) < 1e-5);
  const bad = await paidPost("/v1/convert/units", { value: 1, from: "km", to: "kg" });
  assert.equal(bad.status, 400);
});
test("fx conversion uses bundled ECB snapshot", async () => {
  const { json } = await paidPost("/v1/convert/fx", { amount: 100, from: "USD", to: "JPY" });
  assert.equal(json.as_of, "2026-11-20");
  const expected = 100 * (174.35 / 1.099);
  assert.ok(Math.abs(json.result - expected) < 0.01);
});

// ---------- QR ----------
test("QR matrices verified against an independent oracle (segno RS + spec bitstream)", () => {
  // The oracle (qr-verify.py) rebuilds the function-pattern layer and the
  // data bitstream from the ISO 18004 text, computes RS/interleaving via
  // segno's make_final_message(), and decodes this encoder's matrices with
  // an independent zigzag reader. segno's finished matrices are NOT used
  // as reference: its write_padding_bits() appends a full 0x00 byte when
  // the terminated stream is already byte-aligned, which deviates from
  // the spec's padding rule (decoders ignore pad content, so both forms
  // scan; this encoder follows the spec text).
  const cases = [
    "HELLO WORLD",
    "A",
    "https://example.com",
    "こんにちは、世界",
    "https://www.post.japanpost.jp/service/search/zipcode/download/",
    "x".repeat(100),
    "1234567890".repeat(15),
  ];
  const mine = cases.map((text) => {
    const enc = encodeQr(text);
    return { text, version: enc.version, mask: enc.mask, matrix: enc.matrix };
  });
  const input = JSON.stringify(mine);
  let out;
  try {
    out = execFileSync("python3", [join(here, "qr-verify.py")], { input, maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch (e) {
    out = e.stdout ? e.stdout.toString() : "";
    if (!out) throw e;
  }
  const results = JSON.parse(out);
  results.forEach((r, i) => {
    assert.ok(r.ok, `QR case ${i} (${JSON.stringify(cases[i].slice(0, 24))}) failed: ${r.failures.join("; ")}`);
  });
});
test("QR endpoint returns SVG and PNG", async () => {
  const svg = await paidPost("/v1/qr", { text: "https://example.com", format: "svg" });
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get("content-type"), /image\/svg\+xml/);
  assert.ok(svg.text.startsWith("<svg"));
  const png = await paidPost("/v1/qr", { text: "https://example.com", format: "png" });
  assert.equal(png.status, 200);
  const bytes = Buffer.from(png.json.base64, "base64");
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

// ---------- Web ----------
test("OGP extraction against a local fixture", async () => {
  const { status, json } = await paidPost("/v1/web/ogp", { url: "http://127.0.0.1:14100/page" });
  assert.equal(status, 200);
  assert.equal(json.title, "Fixture Title");
  assert.equal(json.description, "A fixture description");
  assert.equal(json.image, "https://example.com/img.png");
  assert.equal(json.site_name, "FixtureSite");
});
test("OGP SSRF guard rejects private/loopback targets by default", async () => {
  // This test process does NOT have PAYSH_ALLOW_PRIVATE_URLS set (only the
  // spawned server child gets it for the fixture test above), so the
  // production-default guard is active here.
  const { fetchOgp } = await import("../src/modules/web.js");
  await assert.rejects(() => fetchOgp("http://127.0.0.1:14100/page"), /private\/loopback/);
  await assert.rejects(() => fetchOgp("http://localhost:14100/page"), /private\/loopback/);
  await assert.rejects(() => fetchOgp("ftp://example.com/x"), /only http\/https/);
});
test("DNS endpoint returns a structured result", async () => {
  // Note: this sandbox's resolver wildcard-resolves even .invalid names, so
  // only the response shape is asserted here; semantics are unit-tested
  // below with a stub resolver.
  const { status, json } = await paidPost("/v1/web/dns", { name: "example.com", type: "A" });
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.records));
});
test("DNS lookup semantics with a stub resolver", async () => {
  const { dnsLookup } = await import("../src/modules/web.js");
  const stub = {
    resolve4: async () => ["203.0.113.10"],
    resolveMx: async () => [{ exchange: "mail.example.com", priority: 10 }],
    resolveTxt: async () => [["v=spf1 -all"]],
  };
  const a = await dnsLookup("example.com", "A", stub);
  assert.deepEqual(a.records, ["203.0.113.10"]);
  const mx = await dnsLookup("example.com", "MX", stub);
  assert.equal(mx.records[0].exchange, "mail.example.com");
  const txt = await dnsLookup("example.com", "TXT", stub);
  assert.deepEqual(txt.records, ["v=spf1 -all"]);
  const notFound = {
    resolve4: async () => { const e = new Error("not found"); e.code = "ENOTFOUND"; throw e; },
  };
  const nf = await dnsLookup("missing.example", "A", notFound);
  assert.deepEqual(nf.records, []);
  assert.equal(nf.note, "ENOTFOUND");
});
