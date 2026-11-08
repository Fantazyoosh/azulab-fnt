# AKS runtime

Azulab runs on **two runtimes from one artifact**:

| Runtime | Role | Why it exists here |
| --- | --- | --- |
| Azure Container Apps | serverless, scale-to-zero | cheapest way to keep a public demo alive |
| Azure Kubernetes Service | orchestrated containers | the thing this project is meant to teach |

Both pull the same image tag from GHCR, both use the same user-assigned managed
identity, the same Key Vault and the same Storage account. Nothing in the
application knows which runtime it is on.

```
GitHub main ──CI──► GHCR :<commit-sha>
                         │
             ┌───────────┴────────────┐
             ▼                        ▼
     Container Apps              AKS (northcentralus)
     ca-azulab-dev               ns: azulab, HPA 2–6
     managed identity            Workload Identity (federated token)
             │                        │
             └───────────┬────────────┘
                         ▼
              Key Vault + Blob Storage
```

---

## Why `northcentralus`

The subscription is an Azure **Free Trial** (`quotaId: FreeTrial_2014-09-01`,
`spendingLimit: On`). General-purpose VM sizes are restricted per region and
per offer, so "the cheapest region" is not the same as the cheapest *usable*
region.

Every AKS-capable region was cross-checked against `Microsoft.Compute/skus`
and the Retail Prices API. The cheapest node this subscription may actually
create is **`Standard_D2pls_v6` in `northcentralus`**: 2 vCPU / 4 GiB, Arm64,
**$0.062/h**. AKS accepts Arm64 system node pools (validated on 2026-11-07),
and every AKS system image is multi-arch.

| Candidate | Region | $/hour | Why not |
| --- | --- | --- | --- |
| `Standard_D2as_v5` | swedencentral | 0.092 | previous node; 48% more expensive |
| `Standard_D2als_v6` | indiasouthcentral | 0.0804 | x86 fallback, but still more expensive |
| `Standard_D2pls_v6` | **northcentralus** | **0.062** | **chosen** |
| `Standard_D2pls_v6` | eastus3 | 0.062 | AKS is not available in `eastus3` |
| `Standard_D2pls_v6` | centralindia | 0.0408 | `NotAvailableForSubscription` on the Free Trial |

The resource group stays in `polandcentral`; a resource group is a logical
container, not a location restriction. The AKS node resource group
(`MC_rg-azulab-dev-polandcentral_aks-azulab-dev_northcentralus`) is created in
`northcentralus` by AKS itself.

Quota in `northcentralus`: 4 vCPU per family, so a single 2-vCPU node fits.

---

## Deliberate limitations

| Choice | Trade-off | What production would do |
| --- | --- | --- |
| Free tier control plane | no SLA | Standard tier with uptime SLA |
| 1 node | node loss = outage | 3 nodes across zones |
| Arm64 node | cheapest allowed SKU; the image must stay multi-arch | x86 or mixed pools |
| 30 GiB OS disk | tight for many images; fine for this one | size for the image cache and logs |
| `kubenet` | no VNet-native pod IPs | Azure CNI Overlay |
| Public API server | larger attack surface | private cluster + private DNS |
| Local accounts enabled | `az aks get-credentials` returns a cluster-admin kubeconfig | `local_accounts_enabled = false` + Azure RBAC for Kubernetes |
| No ingress controller | one LB per Service | ingress-nginx / AGIC + TLS |
| No cluster autoscaler | HPA 2–6 on one fixed 2-vCPU node; the node is the ceiling | cluster autoscaler + multiple nodes |
| No NetworkPolicy | kubenet has no policy engine | Azure CNI + Calico/Cilium |

Every row is a conscious cost/teaching decision, not an oversight.

---

## Workload Identity, step by step

1. AKS exposes an OIDC issuer (`oidc_issuer_enabled = true`).
2. Terraform creates a federated credential on the managed identity:
   - issuer: the cluster OIDC issuer URL
   - subject: `system:serviceaccount:azulab:azulab`
   - audience: `api://AzureADTokenExchange`
3. The ServiceAccount is annotated with `azure.workload.identity/client-id`.
4. The Pod is labelled `azure.workload.identity/use: "true"`.
5. The webhook injects `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_FEDERATED_TOKEN_FILE`, `AZURE_AUTHORITY_HOST` and projects a
   short-lived service-account token into the container.
6. `DefaultAzureCredential` exchanges that token for an Entra ID token.

There is no client secret in the cluster, in Git, or in Key Vault.

Because the deployment sets `AZURE_TOKEN_CREDENTIALS=WorkloadIdentityCredential`,
the SDK does not waste time probing IMDS or the Azure CLI; it uses exactly one
credential source.

---

## Manifest anatomy

| File | Why it matters |
| --- | --- |
| `namespace.yaml` | Pod Security Admission `restricted` — a weak manifest is rejected, not silently accepted |
| `serviceaccount.yaml` | the identity bridge; the annotation must match the federated credential |
| `deployment.yaml` | `maxUnavailable: 0` + readiness probe = zero-downtime; `preStop` sleep lets kube-proxy drain; liveness checks only the process |
| `service.yaml` | `LoadBalancer` with an HTTP health probe on `/health` |
| `hpa.yaml` | HPA 2 → 6 at 60% CPU; the deployment omits `spec.replicas` so the HPA owns the count |
| `pdb.yaml` | `minAvailable: 1` protects against node drains |
| `kustomization.yaml` | baseline image tag; CD injects the immutable tag on every merge |

### Probe design

| Probe | Endpoint | Depends on | On failure |
| --- | --- | --- | --- |
| startup | `/health` | process only | restart after 60 s |
| readiness | `/ready` | Key Vault secret + Blob Storage | pod removed from Service endpoints |
| liveness | `/health` | process only | pod restarted |

Liveness deliberately **does not** check dependencies. If it did, a Key Vault
outage would restart every replica and turn a degradation into an outage.

### Autoscaling

The HPA scales on CPU utilization relative to the **request**, not the limit:

| Setting | Value | Why |
| --- | --- | --- |
| `minReplicas` | 2 | a rollout or a lost pod never leaves one replica |
| `maxReplicas` | 6 | a single 2-vCPU node can plausibly feed six throttled pods |
| target | 60% of request | a few parallel seals move the metric without flapping |
| request / limit | 100m / 300m | low request makes the signal visible; hard limit protects the kubelet |
| scale-down stabilization | 60 s | long enough to avoid flapping, short enough for a demo |

The load generator is the only CPU-heavy path, and it is opt-in on the Debug tab:
`POST /debug/load` runs PBKDF2 on the libuv threadpool (default 600,000
iterations per round, 8,000,000 total per request) and writes nothing to Blob.
That is real CPU the metrics-server can see, and the event loop keeps answering
health checks while it runs. The product seal itself is a cheap SHA-256. The HPA
reacts on a ~15 s metrics window; a 12-second burst may scale 2 → 3, while a
sustained burn reaches the ceiling of 6 and returns to 2 after the stabilization
window.

There is deliberately **no cluster autoscaler**: the node is fixed, so the HPA
adds pods but cannot add capacity. That limit is the point of the Cost chapter.

---

## Cost

Measured with the Azure Retail Prices API for `northcentralus` (Linux, Arm64):

| Item | $/hour | $/day |
| --- | --- | --- |
| `Standard_D2pls_v6` | 0.062 | 1.49 |
| Standard LoadBalancer | ~0.025 | 0.60 |
| Public IP | ~0.005 | 0.12 |
| Control plane (Free tier) | 0 | 0 |
| **Total** | | **~2.21** |

A subscription budget (`budget-azulab-dev`, 50 per month in the billing currency)
notifies at 80% of actual spend and 100% of the forecast. It is created only when
`budget_alert_email` is set.

Stop the cluster when it is not needed:

```bash
kubectl -n azulab delete service azulab   # release the load balancer and its IP
az aks stop -g rg-azulab-dev-polandcentral -n aks-azulab-dev
```

`az aks stop` deallocates the node VMs; managed disks keep billing (a few cents
per day). The Deployment and pods survive in etcd. **The Service and its public
IP do not.** On start:

```bash
az aks start -g rg-azulab-dev-polandcentral -n aks-azulab-dev
az aks get-credentials -g rg-azulab-dev-polandcentral -n aks-azulab-dev --overwrite-existing

# Recreate ONLY the Service. `kubectl apply -k k8s/` would also reset the image
# to the baseline tag pinned in the manifest.
kubectl apply -f k8s/service.yaml
kubectl -n azulab get svc azulab -w        # a NEW public IP is assigned
```

While the cluster is stopped, the CD `Deploy to AKS` step fails — a code merge
shows a red pipeline (Container Apps still deploys). Docs-only merges are skipped
by `paths-ignore`.

---

## Operations

```bash
# kubeconfig
az aks get-credentials -g rg-azulab-dev-polandcentral -n aks-azulab-dev --overwrite-existing

# cluster state
kubectl get nodes -o wide
kubectl -n azulab get deploy,rs,pods,svc,endpoints -o wide

# rollout
kubectl -n azulab set image deploy/azulab azulab=ghcr.io/fantazyoosh/azulab-fnt:<sha>
kubectl -n azulab rollout status deploy/azulab
kubectl -n azulab rollout undo deploy/azulab

# logs
kubectl -n azulab logs -l app.kubernetes.io/name=azulab --tail=50

# why is a pod not ready?
kubectl -n azulab describe pod <pod>
kubectl -n azulab get events --sort-by=.lastTimestamp
```

---

## Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| `Pending` | node has no allocatable CPU/memory | `kubectl describe node` → Allocated resources |
| `ImagePullBackOff` | wrong tag or GHCR visibility | `curl` the manifest anonymously |
| `CrashLoopBackOff` | config error | `kubectl logs --previous` |
| Ready `False` | Key Vault/Storage unreachable | `kubectl exec ... -- wget -qO- localhost:8080/ready` |
| 503 from the LB | all pods removed from endpoints | `kubectl get endpoints azulab` |
| `401` from Key Vault | federated credential subject mismatch | compare `infra/aks.tf` subject with namespace/SA names |
