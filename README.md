# japan-utils — pay.sh provider service (local build)

A zero-dependency Node.js service that sells deterministic utility APIs to
AI agents over the **x402** protocol (Solana, USDC settlement), built for
listing on **pay.sh** (Solana Foundation × Google Cloud agent API
marketplace). Everything here is local: nothing is deployed, registered,
or published.

- Registry draft: `~/workspace/paysh/registry/nakanuchannnnn/japan-utils/`
  (`PAY.md` + `openapi.json` sidecar — `service_url` is a placeholder).
- Settlement goes to the operator's **public** Solana address only. The
  service holds no keys and never signs anything.

## Layout

```
src/server.js       node:http server; free /health, /openapi.json, / ;
                    payment gate runs before every paid handler
src/x402.js         x402 v1 gate: 402 challenge (body + base64
                    X-PAYMENT-REQUIRED header), structural check of the
                    X-PAYMENT payload, facilitator /verify + /settle,
                    X-PAYMENT-RESPONSE header on success
src/config.js       environment configuration (see below)
src/routes.js       route aggregation
src/modules/        postal, calendar, wareki, text, datetime, convert,
                    qr, web — one file per endpoint group
data/postal.json    Japan Post KEN_ALL snapshot (120,721 unique codes)
data/fx.json        ECB eurofxref daily snapshot (responses carry as_of)
scripts/            build-postal-data.py, build-fx-data.py,
                    gen-openapi.mjs (regenerates openapi.json from routes)
test/local.test.mjs node:test suite (spawns the real server)
test/qr-verify.py   independent QR oracle (see "Verification")
```

## Run locally

```sh
node src/server.js            # http://127.0.0.1:4020
npm test                      # 25 tests, all passing
```

For local development, `PAYSH_DEV_ACCEPT_ANY_PAYMENT=1` accepts any
structurally valid `X-PAYMENT` payload without on-chain settlement.
**Never set it in production.**

## Environment

| Variable | Meaning |
|---|---|
| `PORT` / `HOST` | Listen address (default 4020 / 127.0.0.1) |
| `PAY_TO` | Settlement address (default: the operator's public Phantom address) |
| `FACILITATOR_URL` | x402 facilitator base URL; `/verify` and `/settle` are called per paid request |
| `FACILITATOR_FEE_PAYER` | Facilitator fee-payer address, advertised in the challenge `extra` |
| `X402_NETWORK` | x402 v1 network id (default `solana`; `solana-devnet` only for a test deployment) |
| `X402_ASSET` | Asset mint override (default: Solana mainnet USDC; test deployments only) |
| `PUBLIC_BASE_URL` | Public base URL used in challenge `resource` fields |
| `PAYSH_DEV_ACCEPT_ANY_PAYMENT` | `1` = dev-only structural acceptance (never in production) |
| `PAYSH_ALLOW_PRIVATE_URLS` | `1` = relax the OGP SSRF guard (local tests only, never in production) |

## Endpoints

18 paid endpoints, $0.01–$0.03 per call — see the table in the registry
draft `PAY.md` or `GET /openapi.json` (per-operation `x-payment-info`).
Design-only (not implemented): **furigana** — reliable Japanese reading
annotation needs a MeCab/IPAdic-class morphological dictionary;
segmentation quality cannot be guaranteed offline, so it is excluded
rather than shipped half-correct.

## Verification (all local, 2026-11-22)

- `npm test`: **25/25 pass** — 402 challenge shape (payTo, USDC mint,
  network, per-route amounts), malformed payment rejection, and
  correctness of every endpoint (postal spot checks, JP/US/DE/GB holiday
  rules incl. 国民の休日・振替休日・Easter, wareki era boundaries, romaji
  both directions, timezone/unix, CSV⇔JSON, units, FX math vs the ECB
  snapshot, OGP against a local fixture, DNS shape + stub-resolver
  semantics, SSRF guard negative tests).
- QR encoder verified against an independent Python oracle
  (`test/qr-verify.py`): function patterns rebuilt from the spec, data
  decoded with an independent zigzag reader, RS + interleaving computed
  by segno's `make_final_message()`. Note: segno's *finished matrices*
  differ from this encoder in pad bytes only — segno's
  `write_padding_bits()` appends a full `0x00` byte when the terminated
  stream is already byte-aligned, deviating from ISO 18004 §7.4.10;
  decoders ignore pad content, and this encoder follows the spec text.
- Manual smoke test (production mode, no dev flags): unpaid
  `GET /v1/postal?code=1000001` returns HTTP 402 with the full
  PaymentRequirements JSON and the `X-PAYMENT-REQUIRED` header.
- **Not done:** a real on-chain payment (devnet/surfnet) — there is no
  funded test wallet in this environment, and creating/funding one is an
  operator step. The verify/settle path is exercised structurally in dev
  mode only.

## Production checklist (before any registry PR)

1. Deploy to a public HTTPS URL (any Node host; set `PUBLIC_BASE_URL`).
2. Choose an x402 facilitator; set `FACILITATOR_URL` and
   `FACILITATOR_FEE_PAYER` (from the facilitator's `/supported`).
3. Replace the `service_url` placeholder in `PAY.md` with the real URL;
   confirm the operator directory name.
4. Run `pay catalog check` (from `@solana/pay`) against the registry
   directory and the live deployment — registry CI probes paid endpoints
   and requires a valid Solana x402 challenge accepting mainnet USDC.
5. End-to-end payment test with the pay CLI sandbox
   (RPC `https://402.surfnet.dev`; optionally set `sandbox_service_url`
   in `PAY.md`).
6. Schedule refreshes of `data/postal.json` (Japan Post updates KEN_ALL
   monthly) and `data/fx.json` (ECB daily) via the scripts in `scripts/`.
7. Only then open the PR to `solana-foundation/pay-skills` adding
   `providers/<operator>/japan-utils/{PAY.md,openapi.json}`.
