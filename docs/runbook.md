# 📖 Operational Runbook: Azulab

Standard operating procedure for the two runtimes and the infrastructure behind
them. Every command here has been executed against the live lab.

---

## 1. The Deployment Lifecycle

### Step 1 — Continuous Integration
- Unit tests run on every push (`app/test`).
- The Docker image is built and tagged with the **full Git commit SHA**. `latest`
  is never used: the tag must identify exactly one commit forever.
- The image is pushed to GHCR (`ghcr.io/fantazyoosh/azulab-fnt`).
- `terraform fmt -check` and `terraform validate` gate every PR.

### Step 2 — Continuous Deployment
- The pipeline authenticates to Azure with **OIDC** — no client secret exists.
- Container Apps: `az containerapp update --image <sha>` creates a new revision.
- AKS: the same CD workflow runs `kubectl set image` and waits for the rollout
  (`maxUnavailable: 0`). The manifests in `k8s/` are the baseline; CD injects the
  tag built by the run. A GitOps controller (Argo CD) is the next step for
  reconciling Git and the cluster without a pipeline step.

### Step 3 — Verification
- Container Apps: the CD workflow polls `/health` for up to 150 seconds.
- AKS: `kubectl rollout status deploy/azulab --timeout=240s`, then `curl`.
- **Important:** in Container Apps `Single` revision mode the new revision takes
  traffic as soon as it is ready. A failed smoke test does **not** block traffic —
  it fails the pipeline, and the operator must roll back. The "traffic only shifts
  if smoke passes" claim would require `Multiple` mode with traffic weights.

---

## 2. The Two Runtimes

| | Container Apps | AKS |
| --- | --- | --- |
| Name | `ca-azulab-dev` | `aks-azulab-dev` |
| Region | `polandcentral` | `swedencentral` |
| Scale | 0 → 2 replicas | fixed 2 replicas, 1 node |
| Identity | user-assigned managed identity | Workload Identity (same UAMI) |
| Deploy | `az containerapp update` | `kubectl apply -k k8s/` |
| Rollback | activate previous revision | `kubectl rollout undo` |
| Cost when idle | ~0 | ~2.93 $/day |

Both run the same image and the same application code.

### AKS commands

```bash
az aks get-credentials -g rg-azulab-dev-polandcentral -n aks-azulab-dev --overwrite-existing

kubectl get nodes
kubectl -n azulab get deploy,rs,pods,svc,endpoints -o wide

# deploy a new image
kubectl -n azulab set image deploy/azulab azulab=ghcr.io/fantazyoosh/azulab-fnt:<sha>
kubectl -n azulab rollout status deploy/azulab --timeout=240s

# stop / start (cost control)
kubectl -n azulab delete service azulab   # releases the load balancer and its IP
az aks stop  -g rg-azulab-dev-polandcentral -n aks-azulab-dev
az aks start -g rg-azulab-dev-polandcentral -n aks-azulab-dev

# The Deployment survives; only the Service is gone. Recreate ONLY the Service:
# `kubectl apply -k k8s/` would also reset the image to the baseline tag.
kubectl apply -f k8s/service.yaml
kubectl -n azulab get svc azulab -w        # a NEW public IP is assigned
```

> While the cluster is stopped, CD fails at the `Deploy to AKS` step. A code
> merge shows a red pipeline (Container Apps still deploys); docs-only merges are
> skipped by `paths-ignore`.

---

## 3. Infrastructure as Code (Terraform)

### Lifecycle
1. Declared in `.tf` files.
2. `terraform plan` shows exactly what will change.
3. `terraform apply` converges Azure to the code.

### State
- State lives in Azure Storage: account `stazulabtfstate6mvarl`, container
  `tfstate`, key `azulab.tfstate` (`infra/backend.tf`).
- The storage account is **created outside Terraform** — it must exist before
  `terraform init`, so it cannot be managed by the configuration that stores its
  state there. Bootstrap commands are in the header of `backend.tf`.
- Shared key auth is disabled; the backend uses Entra ID
  (`use_azuread_auth = true`), so the operator needs `Storage Blob Data
  Contributor` on that account.
- State locking is provided by the blob lease: two concurrent `apply` runs
  cannot corrupt the state.
- Local backups are still taken before risky changes:
  `cp terraform.tfstate terraform.tfstate.bak-$(date +%F-%H%M)` (the local file is
  a cache; the source of truth is the blob).

### What Terraform does **not** own
- The running Container App image. CD updates it, so the resource has
  `lifecycle.ignore_changes = [template[0].container[0].image]`.
  Without that, every plan after a deploy proposed a downgrade to the tag pinned
  in `terraform.tfvars`. This actually happened and is the reason for the rule.
- The AKS `upgrade_settings` block is declared explicitly, because the provider
  reads API defaults back and otherwise proposes removing the whole block on
  every plan.

### Drift policy
Never edit resources in the portal. If you do, the next plan proposes to revert
it — and reverting a "small fix" during a demo is how demos die.

---

## 4. Trust Chain (Zero-Trust)

### GitHub → Azure (OIDC)
Federated credentials on the `azulab-github-oidc` app registration restrict access
to this repository, the `main` branch and the `production` environment. The app has
**Contributor on the resource group only** — not on the subscription. Blast radius
is one resource group.

### Application identity
- **Container Apps**: user-assigned managed identity, attached to the app.
- **AKS**: the same identity, reached through Workload Identity.
- Roles: `Key Vault Secrets User` (read secrets) and `Storage Blob Data
  Contributor` (read/write blobs). Nothing else.

### Storage hardening
- `shared_access_key_enabled = false` — key-based authentication is disabled; a key
  can still be listed through ARM, but using it returns
  `KeyBasedAuthenticationNotPermitted`.
- Because of that, the **Terraform provider** must use Entra ID for storage
  operations: `storage_use_azuread = true` in `provider.tf`. Without it, every
  plan fails with `KeyBasedAuthenticationNotPermitted`.
- CLI access must use `az storage ... --auth-mode login`.

### Key Vault hardening
- RBAC authorization, purge protection **on**, soft delete 7 days.
- `soft_delete_retention_days` cannot be changed after creation — 7 is deliberate,
  so the vault name is not reserved for 90 days after teardown.

### Environment variables
Only non-sensitive configuration (`KEY_VAULT_URL`, `STORAGE_ACCOUNT_URL`,
`CONTAINER_NAME`). The app reads the URL and authenticates with its identity.

---

## 4a. Entra ID groups (onboarding / offboarding)

Azure RBAC assignments are held by security groups, not by people or by the
pipeline.

| Group | Role | Scope |
| --- | --- | --- |
| `azulab-deployers` | `Contributor` | resource group |
| `azulab-platform-admins` | `Key Vault Administrator` | the vault |
| `azulab-readers` | `Reader` | resource group |

Create or repair them with `./scripts/setup-entra-groups.sh` (idempotent, retries
the Entra replication delay).

```bash
# onboard a reader
az ad group member add --group azulab-readers --member-id <object-id>

# offboard an admin
az ad group member remove --group azulab-platform-admins --member-id <object-id>
```

Group-based RBAC can take up to 10 minutes to propagate. The pipeline service
principal intentionally has **zero** direct role assignments — if
`az role assignment list --assignee <sp>` is empty, that is correct.

This tenant has Entra ID Free: no PIM, no Conditional Access. Never grant
permanent `Owner` to automation.

---

## 5. Incident Response & Rollback

### Container Apps
1. Portal → Container App → Revisions.
2. Select the last known stable revision.
3. Set traffic to 100% on it.
4. Recovery time ≈ 10 seconds, no rebuild.

### AKS
```bash
kubectl -n azulab rollout history deploy/azulab
kubectl -n azulab rollout undo deploy/azulab
kubectl -n azulab rollout status deploy/azulab
```

### A single bad pod
```bash
kubectl -n azulab describe pod <pod>          # events explain most failures
kubectl -n azulab logs <pod> --previous       # crash logs from the last attempt
kubectl -n azulab delete pod <pod>            # let the ReplicaSet replace it
```

### Total outage (no pod Ready)
```bash
kubectl -n azulab get endpoints azulab        # empty = nothing is ready
kubectl -n azulab exec deploy/azulab -- wget -qO- localhost:8080/ready
```
If the dependency is down, the pods stay alive but out of rotation. Fix the
dependency; do not restart the pods.

---

## 6. Health Check Definitions

| Endpoint | Probe | Checks | Failure action |
| --- | --- | --- | --- |
| `/health` | liveness / startup | process only | restart the container |
| `/ready` | readiness | Key Vault secret loaded + Blob Storage reachable | remove from Service endpoints |
| `/api/message` | smoke | business logic returns valid JSON | pipeline fails |
| `/version` | diagnostic | pod, node, namespace, image SHA | none |

Liveness deliberately does **not** check dependencies.

---

## 7. Troubleshooting & Lessons Learned

### Trap 1 — Missing static files
**Symptom:** `Cannot GET /` with a green pipeline.
**Cause:** `Dockerfile` copied `src` but not `public`.
**Fix:** copy every runtime asset explicitly.

### Trap 2 — Identity lag (403)
**Symptom:** the app starts, Key Vault returns 403.
**Cause:** RBAC propagation takes 30–60 seconds.
**Fix:** retry with backoff (the app now retries the secret load five times).

### Trap 3 — Terraform fighting the CD pipeline
**Symptom:** `terraform plan` wants to change the image back after every deploy.
**Cause:** the image is pinned in `terraform.tfvars`, but CD updates it.
**Fix:** `ignore_changes` on the container image. Terraform owns infrastructure;
CD owns the artifact.

### Trap 4 — AKS rejected every VM size
**Symptom:** `400 BadRequest: The VM size of Standard_B2s is not allowed…`
**Cause:** Free Trial subscription, per-region SKU restrictions. `polandcentral`
only exposes HPC/GPU sizes to this offer.
**Fix:** verify with `Microsoft.Compute/skus` restrictions, then pick a region where
the size is allowed (`swedencentral` here).

### Trap 5 — Storage locked out after hardening
**Symptom:** `403 KeyBasedAuthenticationNotPermitted` during `terraform plan`.
**Cause:** shared key disabled, provider still using key auth.
**Fix:** `storage_use_azuread = true` in the provider block.

### Trap 6 — Readiness switch that could not be turned off
**Symptom:** after `fail-readiness`, the pod left the Service and became
unreachable through the LoadBalancer.
**Cause:** the flag was permanent, and the Service no longer routed to that pod.
**Fix:** the override is time-bounded (`ttl`, default 60 s) and auto-resets.

### Trap 7 — Corrupted HTML shipped to production
**Symptom:** broken viewport meta and a `ReferenceError` in the browser console.
**Cause:** a bad string replacement was committed and merged.
**Fix:** review the rendered output, not only the diff. The UI now shows runtime
identity, so a broken page is immediately visible.

### Trap 8 — Remote backend bootstrap
**Symptom:** `terraform init` fails with `403` or `container not found`.
**Cause:** the state storage account or container does not exist, or the operator
lacks data-plane access (shared key auth is disabled on the state account).
**Fix:** run the bootstrap commands in the header of `backend.tf`, grant
`Storage Blob Data Contributor` on the state account, then
`terraform init -migrate-state`.

---

## 8. Pipeline Behavior

### Why a docs change triggers a deploy
The trigger is repository-level (`on: push`), not path-filtered. A README typo
still builds and deploys an image.

**Optimization** (not enabled, because it would skip the Terraform validate job):
```yaml
on:
  push:
    paths-ignore:
      - 'docs/**'
      - 'README.md'
```
