// pay.sh provider service: Japan-first utility API portfolio gated by
// x402 (Solana USDC). Zero runtime dependencies (Node >= 20 built-ins only).
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { send402, verifyPayment } from "./x402.js";
import { allRoutes } from "./routes.js";

export { allRoutes };
const here = dirname(fileURLToPath(import.meta.url));
const openapi = readFileSync(join(here, "../openapi.json"), "utf8");
const routeMap = new Map(allRoutes.map((r) => [`${r.method} ${r.path}`, r]));

function resourceUrl(req, route) {
  if (config.publicBaseUrl) return `${config.publicBaseUrl}${route.path}`;
  return `http://${req.headers.host || "localhost"}${route.path}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const sendJson = (status, obj, extraHeaders = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(200, { status: "ok", service: "japan-utils", routes: allRoutes.length });
      }
      if (req.method === "GET" && url.pathname === "/openapi.json") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(openapi);
      }
      if (req.method === "GET" && url.pathname === "/") {
        return sendJson(200, {
          service: "japan-utils",
          description: "Pay-per-request utility APIs for AI agents: Japanese postal codes, holidays and business days (JP/US/DE/FR/GB), wareki conversion, text tools, time conversion, CSV/JSON/unit/FX conversion, QR codes, web metadata and DNS.",
          payment: "x402 (Solana USDC). Paid endpoints return HTTP 402 with payment requirements.",
          openapi: "/openapi.json",
          endpoints: allRoutes.map((r) => ({ method: r.method, path: r.path, price_usd: r.priceUsd, summary: r.summary })),
        });
      }
      const route = routeMap.get(`${req.method} ${url.pathname}`);
      if (!route) return sendJson(404, { error: "not found" });

      // Payment gate.
      if (!req.headers["x-payment"]) {
        return send402(res, route, resourceUrl(req, route));
      }
      const verification = await verifyPayment(req, route, resourceUrl(req, route));
      if (!verification.ok) {
        return send402(res, route, resourceUrl(req, route), verification.error);
      }

      let body = null;
      if (req.method === "POST") {
        const rawBody = await readBody(req);
        if (rawBody.trim().length > 0) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            return sendJson(400, { error: "request body must be valid JSON" });
          }
        } else {
          body = {};
        }
      }
      const result = await route.handler({ query: url.searchParams, body, config });
      const headers = { "x-payment-response": verification.responseHeader };
      if (result.raw !== undefined) {
        res.writeHead(result.status || 200, { "content-type": result.contentType || "text/plain", ...headers });
        return res.end(result.raw);
      }
      return sendJson(result.status || 200, result.json, headers);
    } catch (e) {
      return sendJson(500, { error: `internal error: ${e.message}` });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`japan-utils listening on http://${config.host}:${config.port} (payTo=${config.payTo}, devAcceptAnyPayment=${config.devAcceptAnyPayment})`);
  });
}
