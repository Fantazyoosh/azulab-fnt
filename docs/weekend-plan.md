# Weekend plan — azulab (ambitious track)

Two days. Target: one reviewable portfolio artefact by Sunday evening, with the
ability to explain every component without notes.

## Governing rules

- Credit window: ~200 USD / 30 days, ends ~2026-11-27. Lab budget cap: 30 EUR/month.
- Scale-to-zero everywhere it is offered. Destroy nothing that has to be re-created
  before the Rafal review; tear down after.
- Rule from C4: never overclaim. Every artefact carries one line:
  "hands-on personal lab — not enterprise production. Here is exactly what it
  does and does not prove."
- Nothing ships to GitHub as a secret. OIDC only.

## Exit criteria for Sunday 20:00

1. Public repo with clean commit history and a README a stranger can follow.
2. `terraform apply` from a clean state completes in < 15 min and produces a
   working HTTPS URL.
3. At least one PR pipeline run (green) on a feature branch.
4. At least one CI run building and pushing an immutable image tag to GHCR.
5. At least one CD run deploying that tag with a successful smoke test.
6. One documented, performed rollback (revision A -> B -> A), timed and written up.
7. One 3-minute demo script rehearsed once aloud.
8. Security notes rehearsed: Key Vault RBAC, OIDC, geo-block answer.
9. Cost reviewed: `az consumption usage` / portal cost analysis screenshot.

## Saturday — build

### S0. Authenticate and orient (09:00-10:00, 1 h)

- Azure device login; confirm subscription and credit remaining.
- GitHub login; create repo, push current `main`.
- Portal tour: resource groups, cost management, activity log.
- Decide one region (polandcentral) and one naming convention; write it down.

### S1. Provision infrastructure (10:00-12:00, 2 h)

```sh
cd infra
terraform init
terraform apply -var="image=mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
```

- Read every resource Terraform created. Open each in the portal.
- Record: RG name, app URL, identity client id, storage account, Key Vault.
- Failure budget: if any resource fails (region quota etc.), do not hack around —
  write the error and switch `location` via a single tfvar.

### S2. First real deploy (12:30-14:30, 2 h)

- `scripts/setup-oidc.sh`, store variables in GitHub.
- Push the existing image (manual `az containerapp update`) and confirm the real
  `/health`.
- Add the Key Vault secret `app-message`; redeploy; confirm `/api/message`.
- Smoke-test `/api/blobs` (upload + list).

### S3. CI/CD the hard way (15:00-18:00, 3 h)

- Open a feature branch, change `app-message` default, open a PR.
- Watch `pr.yml`: fix anything that breaks. Understand each job and why it exists.
- Merge; watch `ci.yml` build+push.
- Watch `cd.yml` deploy and smoke-test. If it does not trigger, learn why
  (`workflow_run` semantics) — do not just re-click.
- Record one successful run screenshot set.

### S4. Deepen one component (18:00-19:30, 1.5 h)

Pick ONE. Recommended for this role target: Key Vault + RBAC.

- Explain: tenant, object id, role definition, scope, principal type.
- Show `az role assignment list` at vault scope.
- Toggle (conceptually) what breaks if the identity loses `Key Vault Secrets User`.
- Write half a page: what this proves and what it does not.

### S5. Pack the day (19:30-20:00, 0.5 h)

- Update `docs/rollback.md` placeholders with real names.
- Commit and push everything.
- Write tomorrow's "must finish" list; stop.

## Sunday — defend and polish

### U0. Budget review first (09:00-09:30)

- Portal cost analysis / `az consumption usage list`.
- Confirm scale-to-zero and no VMs left running.

### U1. Rollback drill (09:30-11:00, 1.5 h) — non-negotiable

1. Deploy v2 (change the message).
2. Deploy v3 (break health probe on purpose).
3. Observe gate behaviour; time the rollback.
4. Restore v2; verify 200.
5. Write `docs/rollback-log.md` with timings.

### U2. Monitoring (11:00-12:00, 1 h)

- Log Analytics: query for 4xx/5xx and request duration for the test request.
- App Insights: one trace visible. Note where token/cost counters would live.

### U3. Security depth (13:00-14:30, 1.5 h)

- Geo-block question rehearsal (Front Door WAF geomatch, IP allow-list
  limitation of storage, private endpoint trade-off).
- OIDC walkthrough: issuer, subject, audience, what prevents replay.
- Review overscoped RBAC; list three least-privilege improvements you would make
  for production.

### U4. Interview prep (15:00-17:00, 2 h)

- 3-min demo script, twice on camera/voice.
- 15-question bank from `docs/questions.md` mapped to file paths.
- Rewrite CV "homelab" line to reference commits (do not inflate; keep the
  honesty line).

### U5. Rafal review (17:00-20:00)

- Send repo link + demo recording.
- 30 min walkthrough; ask which component to deepen.
- Capture feedback into `docs/feedback.md` the same day, while it is fresh.

## Cut list (decide on a checkpoint, not in a panic)

- Cut first: monitoring polish, audyt 12-factor v2, Claude Academy courses.
- Never cut: deploy (S1), at least one green pipeline (S3), rollback drill (U1).
- If S1 fails for > 90 min on one error, stop and switch Azure region the next
  morning, not at midnight.

## Honesty line

Every document and demo repeats: "hands-on personal lab, not enterprise
production — here is exactly what it does and does not prove."
