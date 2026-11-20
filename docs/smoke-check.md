# Smoke test run 2026-11-20T18:47:11Z

Endpoint: AKS `http://20.80.52.28` and ACA `https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io`.
Image: `ghcr.io/fantazyoosh/azulab-fnt:b465aa67566e8d022ae629fc0cd0850686cde538`.

| Check | Answer |
|---|---|
| `GET /health` | `{"status":"ok","service":"azulab","now":"2026-11-20T18:47:09.096Z"}` |
| `GET /ready` | `{"status":"ready","checks":{"keyVault":"ok","signingKey":"c7136de0e3414175ac785fe505e8d43a","storage":"ok","storageConsecutiveFailures":0}}` |
| `GET /api/config` | `keyVault: "keyvault"`, `keyVersion: "c7136de0e3414175ac785fe505e8d43a"`, `sealAlgorithm: "SHA256-SALTED"` |
| `GET /api/blob/stats` | `{"container":"drops","objects":30,"bytes":314874}` |
| `GET /health` (ACA) | `{"status":"ok","service":"azulab","now":"2026-11-20T18:48:11.931Z"}` — no cold start this run |
| `GET /api/config` (ACA) | `401` — Easy Auth, correct without a session |

Notes:

- Blob size is not 0 any more: the counter reads `item.properties.contentLength`
  (commit `cfabf23`). 30 objects, 314874 bytes.
- `bytes` was 0 before that commit; the fix reached the cluster with CD run
  `44795006309` (success).
- `/api/message` and `/api/blobs` are gone, so they are not part of this run.
  `/debug/load` is not called either.

## History

# Smoke test run 2026-10-31T18:40:47Z
