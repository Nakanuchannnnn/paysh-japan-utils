// x402 (v1) payment gate for Solana "exact" scheme, implemented directly
// against the protocol so the service has zero runtime dependencies.
//
// Flow:
//   1. Request without X-PAYMENT header -> 402 + PaymentRequirements JSON
//      (also mirrored base64-encoded in the X-PAYMENT-REQUIRED header).
//   2. Request with X-PAYMENT header -> payload is verified and settled
//      through the configured facilitator (/verify then /settle).
//      In local dev mode (PAYSH_DEV_ACCEPT_ANY_PAYMENT=1) a structurally
//      valid payload is accepted without settlement, for testing only.
import { config } from "./config.js";

export function paymentRequirements(route, resourceUrl) {
  const extra = { name: config.assetName, version: "2" };
  if (config.facilitatorFeePayer) extra.feePayer = config.facilitatorFeePayer;
  return {
    scheme: "exact",
    network: config.network,
    maxAmountRequired: route.priceAtomic,
    resource: resourceUrl,
    description: route.summary,
    mimeType: "application/json",
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    asset: config.usdcMint,
    extra,
  };
}

export function challengeBody(route, resourceUrl, error) {
  return {
    x402Version: 1,
    error: error || "X-PAYMENT header is required",
    accepts: [paymentRequirements(route, resourceUrl)],
  };
}

export function send402(res, route, resourceUrl, error) {
  const body = challengeBody(route, resourceUrl, error);
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64");
  res.writeHead(402, {
    "content-type": "application/json",
    "x-payment-required": payload,
  });
  res.end(JSON.stringify(body));
}

function parsePaymentHeader(req) {
  const raw = req.headers["x-payment"];
  if (!raw || typeof raw !== "string") return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function structurallyValid(payload, route) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.x402Version !== 1) return false;
  if (payload.scheme !== "exact") return false;
  if (payload.network !== config.network) return false;
  const tx = payload.payload && payload.payload.transaction;
  if (typeof tx !== "string" || tx.length < 40) return false;
  return true;
}

async function facilitatorPost(path, body) {
  const resp = await fetch(`${config.facilitatorUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`facilitator ${path} HTTP ${resp.status}`);
  return resp.json();
}

// Returns { ok: true, responseHeader } or { ok: false, error }.
export async function verifyPayment(req, route, resourceUrl) {
  const payload = parsePaymentHeader(req);
  if (!payload) return { ok: false, error: "X-PAYMENT header is required or malformed" };
  if (!structurallyValid(payload, route)) {
    return { ok: false, error: "X-PAYMENT payload failed structural validation" };
  }
  if (config.devAcceptAnyPayment) {
    const response = { success: true, network: config.network, dev: true, payer: null };
    return {
      ok: true,
      responseHeader: Buffer.from(JSON.stringify(response), "utf8").toString("base64"),
    };
  }
  if (!config.facilitatorUrl) {
    return { ok: false, error: "payment verification unavailable: no facilitator configured" };
  }
  const requirements = paymentRequirements(route, resourceUrl);
  const verifyBody = { x402Version: 1, paymentPayload: payload, paymentRequirements: requirements };
  const verification = await facilitatorPost("/verify", verifyBody);
  if (!verification || verification.isValid !== true) {
    return { ok: false, error: `payment invalid: ${(verification && verification.invalidReason) || "unknown"}` };
  }
  const settlement = await facilitatorPost("/settle", verifyBody);
  if (!settlement || settlement.success !== true) {
    return { ok: false, error: `settlement failed: ${(settlement && settlement.errorReason) || "unknown"}` };
  }
  const response = {
    success: true,
    transaction: settlement.transaction || null,
    network: config.network,
    payer: settlement.payer || verification.payer || null,
  };
  return {
    ok: true,
    responseHeader: Buffer.from(JSON.stringify(response), "utf8").toString("base64"),
  };
}
