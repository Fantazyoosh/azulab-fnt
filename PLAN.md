# PLAN — work orders

This file is a list of work orders for the cheaper default model
(`deepseek-v4.1-flash`), not for the premium one. That is why it is exact about
commands and good answers — not because the model needs small steps, but
because exact steps cut errors and keep the context short, and a short context
is money on a model paid per token. Each task stands on its own, so sessions
can split freely. Do the steps in order. After every step, run the check and
read the answer before you go on. Never say "it works" without the command
and the output that proves it.

Read `AGENTS.md` in this folder before you start. It has the project rules and
the command table.

## What this project is

Azulab Drop is a small file-sharing app. Its true purpose is to make Azure easy
to see: Blob Storage, Key Vault, managed identity, autoscaling, cost. Three parts:
`infra/` (Terraform), `app/` (Node), `k8s/` (manifests). `agentlab/` is a second
repo — do not add or change its files.

## Hard rules

- Money first. No `terraform apply`. No new paid resource. `terraform plan` is
  read-only and allowed.
- Never print a secret. Never commit a secret.
- Do not call `/debug/load` — it burns CPU on purpose. Do not call
  `/api/message` or `/api/blobs` — those endpoints are gone and return 404.
- Ask before any of these: `git push`, `kubectl apply`, `terraform apply`, and
  any Azure command with `create`, `delete`, `set` or `update`.
- Reply in the language of the question. Code, commit messages and this file
  stay English.
- Commit style: conventional commits (`fix:`, `docs:`, `feat:`), English, short.

## Task 1 — fix the blob size counter

Bug. The live endpoint `/api/blob/stats` says `objects: 30, bytes: 0`. The code
reads the size from the wrong field.

1. Read `app/src/blob-admin.js`, lines 30–45. The loop has
   `bytes += item.contentLength || 0` and `const tier = item.tier || "Hot"`.
2. In the Azure SDK these fields are one level deeper. Make two changes:
   - `item.contentLength` → `item.properties.contentLength`
   - `item.tier` → `item.properties.accessTier`
3. Take a look at `app/test/blob.test.js` first. The stats test (line 65) has a
   fixed answer inside, so it will still pass. Keep the test local — no live
   Azure call from a unit test.
4. `cd app && npm ci` (only if `node_modules` is not there), then `npm test`.
   Good answer: 41 tests, 0 failed.
5. `npm run lint`. Good answer: no output, exit code 0.
6. Commit: `fix(app): take blob size and tier from item.properties`.
   Do not push — that needs the user's yes.

Done when: the code uses `item.properties.contentLength`, tests and lint pass,
and the commit is local.

## Task 2 — put a new smoke test in `docs/smoke-check.md`

The file holds one old line from 2026-10-31 and no answers. Fill it with a real
run. (This is also the `azulab-smoke-test` skill — read it if you have it.)

1. Get the AKS address:
   `kubectl -n azulab get svc azulab -o jsonpath='{.status.loadBalancer.ingress[0].ip}'`
2. Run four checks and keep every answer:
   - `curl -sS http://$AKS/health` → `{"status":"ok",...}`
   - `curl -sS http://$AKS/ready` → `{"status":"ready",...}`
   - `curl -sS http://$AKS/api/config | jq '{keyVault,keyVersion,sealAlgorithm}'`
     → `keyVault` is `"keyvault"`, a key version is there,
     `sealAlgorithm` is `SHA256-SALTED`
   - `curl -sS http://$AKS/api/blob/stats | jq '{container,objects,bytes}'`
3. ACA is behind Easy Auth, so 401 is the right answer without a session:
   - `curl -sS https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io/health`
     The first call may time out — that is the cold start (scale to zero).
     Send the request again.
   - `curl -sS -o /dev/null -w '%{http_code}\n' .../api/config` → 401.
4. Write the answers into `docs/smoke-check.md`: date in UTC, one line per
   check, the answer. Keep the old header under the new run as history.
5. Commit: `docs: smoke test run <UTC date>`.

Done when: the file has today's date and five checks with their answers.

## Task 3 — Terraform: init, validate, plan (read-only)

The local `infra/.terraform` folder is not there. State is remote; `init` only
gets the plugins.

1. `terraform -chdir=infra init`. Do not take any "migrate state" offer — the
   backend config is already right.
2. `terraform -chdir=infra validate` → a `Success! ...` message.
3. `terraform -chdir=infra plan -no-color -detailed-exitcode | tail -30`
   - exit code 0 → no changes. Say "no changes".
   - exit code 2 → drift. Give the last 30 lines to the user. Change nothing.
4. Keep the last 30 lines of the plan output for the final report.
   Never `apply`.

Done when: you can name the plan output and the exit code.

## Task 4 — check CI and the image tag (read-only)

The tag must be the short SHA of the newest commit that CI built. Do not write a
fixed SHA here: CD moves the tag on every push, so a hard-coded value goes stale.
Ask git for the value.

1. `gh run list --limit 10` — find the newest `CI` and `CD` runs for `main`.
   Ignore `CI` runs with state `skipped`: a docs-only push does not build.
2. Get the tag on the cluster:
   `kubectl -n azulab get deploy azulab -o jsonpath='{.spec.template.spec.containers[0].image}'`
3. Get the commit that CD built:
   `gh run list --workflow=cd.yml --limit 1 --json headSha,conclusion`
   (or read the commit of the newest green `CD` run in the list).
4. Say whether the runs are green and whether the tag matches that commit.

Example, run of 2026-11-20: the tag was
`ghcr.io/fantazyoosh/azulab-fnt:b465aa67…`, and CD run `44795006309` built
`b465aa6`. The match was correct.

Done when: the report names the runs, their state, and the live tag.

## When all tasks are done

Write one report for the user:

- what changed: files and commits
- test and lint numbers
- the five smoke-check answers
- the Terraform plan output and exit code
- CI state and the live image tag
- what you did not do, and why (example: "no push — needs the user's yes")

Cost note: every task here is read-only or local. No task adds a paid resource,
so the monthly bill does not change.
