# Learning guide — what v0.2 changed and why

Read this **before** the weekend. Each item below is a small, deliberate change you
should open in your editor and re-type yourself during Saturday (even though the
code already ships). The goal is not to memorise it — it is to be able to explain
it without looking.

## 1. `src/config.js` — fail fast
- All env vars flow through one place; integers are validated at boot.
- `MAX_UPLOAD_BYTES`, `SHUTDOWN_TIMEOUT_MS` have sane defaults.
- 12factor III: config in env, but *validated*, not stringly-typed.
- Task: break `PORT=abc` and observe the boot failure. Break `MAX_UPLOAD_BYTES=0`.

## 2. `src/logger.js` — structured logs
- `pino` writes JSON to stdout, collected by Log Analytics (no agent config).
- base fields: `service`, `version`, ISO timestamp.
- Task: run the app and pipe output through `pino-pretty` once; notice how easy
  grep/filtering is vs. `console.log`.

## 3. `src/metrics.js` — in-memory percentiles
- Ring buffer of the last 1000 latencies; p50/p95/p99 computed on request.
- **Not** a replacement for App Insights; a pedagogical bridge to it.
- Task: /metrics after 20 requests; change to p99.9 and see the math.

## 4. `src/server.js`
### correlation id
- Accepts `X-Request-Id` from the caller; generates a UUID otherwise; echoes it.
- Later you will see it in App Insights and join requests across hops.

### request pipeline
- JSON body limited by config.
- request log with method/path/status/durationMs.
- metrics recorded in the same `res.on('finish')` hook (single source of truth).

### `/health` vs `/ready`
- `/health`: is the process alive? (liveness probe)
- `/ready`: can it serve? checks Key Vault status + storage config (readiness probe)
- Why both: Kubernetes/Container Apps replace pods/replicas only when *ready* is
  down; *health* down kills and restarts. Mixing them causes flapping.

### `/api/blobs` CRUD
- Name validation regex (path traversal, slashes, spaces) before any SDK call.
- Size limit enforced server-side (413).
- Storage check (503) after input validation — bad input is always 400.
- Download streams from blob; delete is idempotent.

### central error handler
- Never leaks stack trace; always returns `{ error, message, requestId }`.

### graceful shutdown
- SIGTERM/SIGINT → stop accepting new connections, finish in-flight, exit.
- `server.close` + forced exit on `SHUTDOWN_TIMEOUT_MS`.
- `/ready` flips to `shutting_down` immediately so the LB stops sending traffic.
- Task: `docker run`, then `docker kill --signal=TERM`; watch the logs. Compare
  with `docker kill` (SIGKILL) and explain the difference — this is IX in
  the 12 factors.

## 5. `infra/main.tf`
- `liveness_probe` on `/health`, `readiness_probe` on `/ready`.
- `min_replicas = 0`, `max_replicas = 2`.
- Task: set `min_replicas = 1`, apply, note the cost difference the next morning.

## Weekend self-tasks (do these yourself)
- [ ] Re-implement graceful shutdown from memory.
- [ ] Run `npm test`, then delete one assertion and confirm the suite still
      passes (mutation test) — prove tests actually assert something.
- [ ] Add `GET /api/blobs/:name` test with a *wrong* name (no storage) → 400.
- [ ] Write one new test you are proud of and paste it in docs/questions.md.
- [ ] Explain, out loud and without notes, why storage account has no country rule
      (see docs/security.md) and where geo-blocking belongs.
- [ ] Time the rollback drill; write it into docs/rollback-log.md.

## Seniority notes (lines to memorise)
- "/health and /ready are different probes for different reasons; conflating them
  causes flapping during rollouts."
- "SIGTERM graceful shutdown is what IX (Disposability) means in practice; a
  container that needs 30 s to die is not disposable."
- "I store no cloud secrets in CI: OIDC issuer/subject/audience, not long-lived
  credentials."
- "Storage accounts don't do country filtering; geo belongs at the edge (Front
  Door WAF geomatch); I can price the trade-off."
- "Every claim in my CV has a commit; here is the path."
