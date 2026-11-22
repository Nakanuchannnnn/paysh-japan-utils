// Runtime configuration (environment-driven).
// No secrets are required: the service only *receives* payments to a public
// Solana address. It never holds or uses any private key.
export const config = {
  port: Number(process.env.PORT || 4020),
  host: process.env.HOST || "127.0.0.1",

  // Payment recipient (public address only).
  payTo: process.env.PAY_TO || "HEFgZ9L5S9U9ScwfFw67Y3AivGQXSNhYZFFRQuACegsK",
  network: process.env.X402_NETWORK || "solana", // x402 v1 network id
  // Solana mainnet USDC mint. X402_ASSET overrides it only for a future
  // devnet-configured test deployment; production must keep the default.
  usdcMint: process.env.X402_ASSET || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  assetName: "USD Coin",
  maxTimeoutSeconds: 120,

  // Facilitator used to verify/settle x402 payments in production.
  // POST {facilitatorUrl}/verify and {facilitatorUrl}/settle.
  facilitatorUrl: (process.env.FACILITATOR_URL || "").replace(/\/$/, ""),
  // Optional fee-payer address advertised in the challenge `extra` field
  // (normally the facilitator's fee payer, from its /supported response).
  facilitatorFeePayer: process.env.FACILITATOR_FEE_PAYER || "",

  // LOCAL DEVELOPMENT ONLY: when "1", any structurally valid X-PAYMENT
  // payload is accepted without on-chain settlement. Never set in production.
  devAcceptAnyPayment: process.env.PAYSH_DEV_ACCEPT_ANY_PAYMENT === "1",

  // SSRF guard for the web endpoints. "1" allows private/loopback targets
  // (used by the local test-suite only). Never set in production.
  allowPrivateUrls: process.env.PAYSH_ALLOW_PRIVATE_URLS === "1",

  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
};
