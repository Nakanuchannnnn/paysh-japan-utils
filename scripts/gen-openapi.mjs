// Generate openapi.json from the route registry (single source of truth).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { allRoutes } from "../src/routes.js";

const here = dirname(fileURLToPath(import.meta.url));

const paths = {};
for (const route of allRoutes) {
  const op = {
    operationId: route.id.replace(/\./g, "_"),
    summary: route.summary,
    responses: {
      "200": { description: "Successful response (after x402 payment)" },
      "402": { description: "Payment required: x402 PaymentRequirements JSON (Solana USDC)" },
      "400": { description: "Invalid request parameters" },
    },
    "x-payment-info": {
      protocols: ["x402"],
      pricingMode: "fixed",
      price: route.priceUsd.toFixed(2),
      currency: "USD",
      network: "solana",
      asset: "USDC",
    },
  };
  if (route.query) {
    op.parameters = Object.entries(route.query).map(([name, spec]) => ({
      name,
      in: "query",
      required: !!spec.required,
      description: spec.description,
      schema: { type: spec.type },
      example: spec.example,
    }));
  }
  if (route.body) {
    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: route.body.required || [],
            properties: route.body.properties,
          },
        },
      },
    };
  }
  paths[route.path] = { ...(paths[route.path] || {}), [route.method.toLowerCase()]: op };
}

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Japan Utils — pay-per-request utility APIs for AI agents",
    version: "0.1.0",
    description:
      "Deterministic utility APIs priced per request in Solana USDC via x402: Japanese postal code lookup, holidays/business days (JP/US/DE/FR/GB), wareki conversion, kana-romaji/slug/width text tools, timezone and Unix time conversion, CSV/JSON/unit/FX conversion, QR code generation, web metadata extraction and DNS lookup. Paid operations return HTTP 402 with x402 payment requirements when called without an X-PAYMENT header.",
  },
  servers: [{ url: "https://japan-utils.example.com" }],
  paths,
};
const out = join(here, "../openapi.json");
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");
console.log(`wrote ${out} with ${Object.keys(paths).length} paths`);
