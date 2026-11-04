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
     Container Apps              AKS (swedencentral)
     ca-azulab-dev               ns: azulab, HPA 2–6
     managed identity            Workload Identity (federated token)
             │                        │
             └───────────┬────────────┘
                         ▼
              Key Vault + Blob Storage
```

---

## Why `swedencentral`

The subscription is an Azure **Free Trial** (`quotaId: FreeTrial_2014-09-01`,
`spendingLimit: On`). Compute SKU availability is restricted per region and
offer. Measured with `Microsoft.Compute/skus` restrictions:

| Region | `Standard_B2s` | `Standard_D2as_v5` |
| --- | --- | --- |
| polandcentral | not available | not available |
| westeurope | not available | not available |
| northeurope | not available | not available |
| germanywestcentral | not available | not available |
| eastus / eastus2 | not available | not available |
| uksouth / francecentral | not available | not available |
| **swedencentral** | `B2s_v2` available | **available** |

The resource group stays in `polandcentral`; a resource group is a logical
container, not a location restriction. The AKS node resource group
(`MC_rg-azulab-dev-polandcentral_aks-azulab-dev_swedencentral`) is created in
`swedencentral` by AKS itself.

Quota in `swedencentral`: 4 vCPU per family, so a single 2-vCPU node fits.

---

## Deliberate limitations

| Choice | Trade-off | What production would do |
| --- | --- | --- |
| Free tier control plane | no SLA | Standard tier with uptime SLA |
| 1 node | node loss = outage | 3 nodes across zones |
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

The seal is PBKDF2 on the libuv threadpool, roughly a third of a core-second at
600,000 iterations. That is real CPU the metrics-server can see, and the event
loop keeps answering health checks while it runs. The HPA reacts on a ~15 s
metrics window; a 12-second burst may scale 2 → 3, while a sustained burn reaches
the ceiling of 6 and returns to 2 after the stabilization window.

There is deliberately **no cluster autoscaler**: the node is fixed, so the HPA
adds pods but cannot add capacity. That limit is the point of the Cost chapter.

---

## Cost

Measured with the Azure Retail Prices API for `swedencentral` (Linux):

| Item | $/hour | $/day |
| --- | --- | --- |
| `Standard_D2as_v5` | 0.092 | 2.21 |
| Standard LoadBalancer | ~0.025 | 0.60 |
| Public IP | ~0.005 | 0.12 |
| Control plane (Free tier) | 0 | 0 |
| **Total** | | **~2.93** |

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
