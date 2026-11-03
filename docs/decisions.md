# Architecture decisions (ADR)

Each decision records the context, the choice, and the consequences — including
the ones that hurt. "We did not know" is not an option; "we accepted this cost"
is.

---

## ADR-001 — Two runtimes instead of one

**Context.** Container Apps is the cheapest way to keep a public demo. The mentor
requirement is a real Kubernetes demo, and Kubernetes is the industry baseline.

**Decision.** Run the same image on both. Container Apps stays as the serverless
runtime; AKS is the orchestrated one.

**Consequences.**
- One artifact, two runtimes: the image tag is the contract.
- Two deployment paths to maintain (CD for ACA, manual for AKS).
- Slightly higher cost and cognitive load, much stronger interview story.

---

## ADR-002 — AKS in `swedencentral`, resource group in `polandcentral`

**Context.** The subscription is Azure Free Trial (`quotaId FreeTrial_2014-09-01`).
`Microsoft.Compute/skus` restrictions reject every general-purpose VM size in
`polandcentral`, `westeurope`, `northeurope`, `germanywestcentral`, `eastus`,
`eastus2`, `uksouth` and `francecentral`.

**Decision.** Create the cluster in `swedencentral`, where `Standard_D2as_v5` is
allowed. Keep the resource group in Poland.

**Consequences.**
- Cross-region latency between the cluster and Key Vault/Storage (single-digit
  milliseconds; irrelevant for this workload).
- A resource group is a logical container — the split is legal and common.
- If the subscription is upgraded, the cluster can move to `polandcentral`.

---

## ADR-003 — GHCR instead of ACR

**Context.** CI already publishes to GHCR. The image is public. ACR Basic costs
about 5 $/month and adds a credential path (`AcrPull` for the kubelet identity).

**Decision.** Pull from GHCR; do not create ACR. The ACR that existed was
destroyed and no workload depended on it.

**Consequences.**
- No `AcrPull` role, no image pull secret, one less failure mode.
- A public image is fine for a portfolio project; a private one would require
  ACR or an image pull secret.
- Trade-off documented: production would likely use ACR with private endpoints.

---

## ADR-004 — `kubenet` networking

**Context.** Azure CNI requires VNet and subnet planning. Azure CNI Overlay is
the modern default but adds concepts that do not change the demo.

**Decision.** `network_plugin = "kubenet"`, AKS-managed VNet.

**Consequences.**
- No IP exhaustion planning, no custom subnet.
- No NetworkPolicy enforcement (kubenet has no policy engine).
- Production: Azure CNI Overlay + Calico/Cilium.

---

## ADR-005 — Free tier control plane, one node

**Context.** The lab budget is credits, not a company card.

**Decision.** `sku_tier = "Free"`, `node_count = 1`, `Standard_D2as_v5` (2 vCPU / 8 GiB).

**Consequences.**
- No control-plane SLA; node loss is an outage.
- Pod-level HA is still demonstrated with 2 replicas and a PodDisruptionBudget.
- ~2.93 $/day total; `az aks stop` when idle.

---

## ADR-006 — Workload Identity instead of secrets or pod-managed identity

**Context.** Pod-managed identity (aad-pod-identity) is deprecated. Kubernetes
Secrets are base64, not encryption.

**Decision.** AKS OIDC issuer + federated identity credential + annotated
ServiceAccount + labelled pod.

**Consequences.**
- No Secret object, no client secret, no rotation job.
- The trust is a single string (`system:serviceaccount:azulab:azulab`); renaming
  the namespace or ServiceAccount breaks authentication. That is a feature: the
  binding is explicit.
- Requires `oidc_issuer_enabled` and `workload_identity_enabled`, which cannot be
  disabled after cluster creation.

---

## ADR-007 — Readiness checks dependencies, liveness does not

**Context.** A dependency outage must not restart every replica.

**Decision.**
- `readinessProbe` → `/ready` (Key Vault + Blob Storage)
- `livenessProbe` → `/health` (process only)

**Consequences.**
- A Key Vault outage drains the Service endpoints but keeps pods alive for
  debugging.
- `/ready` uses a 2 s timeout, 10 s cache and a two-consecutive-failures rule so a
  transient blip does not flap the Service.

---

## ADR-008 — Terraform does not own the running image

**Context.** The image tag was pinned in `terraform.tfvars` while CD updated the
running revision. Every `terraform plan` proposed a downgrade — including once,
minutes before a demo.

**Decision.** `lifecycle.ignore_changes = [template[0].container[0].image]` on the
Container App resource.

**Consequences.**
- Terraform owns infrastructure; CD owns the artifact. One owner per concern.
- The bootstrap image still comes from `var.image` on first creation.
- The same principle is why the AKS manifest pins an immutable SHA rather than
  `latest`.

---

## ADR-009 — No ingress controller, no HPA, no service mesh

**Context.** Each adds pods, CRDs or cost, and none changes the lesson.

**Decision.** A `LoadBalancer` Service, fixed 2 replicas, no mesh.

**Consequences.**
- One public IP per Service; no TLS termination or path routing.
- No autoscaling demonstration. HPA on a 2 vCPU node with a 50m request would
  mostly demonstrate scheduling, not scaling.
- Documented as the production next step.

---

## ADR-010 — Public LoadBalancer for the demo

**Context.** `kubectl port-forward` is free but binds the demo to one laptop and
one terminal.

**Decision.** Standard LoadBalancer with an HTTP health probe.

**Consequences.**
- A stable public URL for the mentor call, reachable from any device.
- ~0.72 $/day while it exists.
- Must be deleted (`kubectl delete svc azulab`) before `az aks stop` to release
  the public IP.

---

## ADR-011 — One managed identity for both runtimes

**Context.** Two runtimes could have two identities, doubling the RBAC surface.

**Decision.** A single user-assigned identity, attached to the Container App and
federated to the AKS ServiceAccount.

**Consequences.**
- One set of role assignments to audit.
- Compromise of either runtime yields the same data-plane scope.
- A production split (per environment, per runtime) would be stricter; for a lab,
  one identity is the honest simplification.

---

## ADR-012 — The application secret is bootstrapped outside Terraform

**Context.** The secret value was a Terraform attribute, so it lived in Git.

**Decision.** Remove the resource from state with
`removed { lifecycle { destroy = false } }`; set the value with `az keyvault
secret set`.

**Consequences.**
- No secret value in the repository.
- Bootstrap is a documented manual step; a fresh environment needs it before the
  app becomes ready.
- Terraform no longer rotates or deletes the secret.

---

## ADR-013 — RBAC assignments are held by Entra ID groups

**Context.** Roles were assigned directly to the human and to the pipeline service
principal. Onboarding a second engineer meant repeating the assignment on every
resource; offboarding meant finding all of them. The tenant has no Entra ID P1/P2,
so PIM (time-bound elevation) is not available.

**Decision.** Three security groups hold the assignments:

- `azulab-deployers` → `Contributor` on the resource group (the pipeline SP is a
  member; it has no direct roles)
- `azulab-platform-admins` → `Key Vault Administrator` on the vault
- `azulab-readers` → `Reader` on the resource group (empty onboarding path)

Runtime identities keep direct, narrow assignments: they are created by
Terraform, have one scope, and must not depend on group propagation during a
deploy.

**Consequences.**
- Membership is the unit of change; offboarding is one `member remove`.
- Group-based RBAC can take up to 10 minutes to replicate. The first role
  assignment failed with `PrincipalNotFound`; `scripts/setup-entra-groups.sh`
  now retries.
- Without PIM there is no time-bound elevation. Compensating controls: narrow
  scopes, one human `Owner`, no data-plane roles for automation.
- Debugging "why can this principal do X" now starts with group membership, not
  with direct role assignments.
