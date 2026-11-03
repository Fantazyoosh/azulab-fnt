# Demo script — Kubernetes on AKS

Target: 12–15 minutes. Every command has a one-line "what to say" next to it.
Run from the repository root.

---

## 0. Pre-flight (before the call)

```bash
az account show --query "{sub:name, id:id}" -o table
az aks get-credentials -g rg-azulab-dev-polandcentral -n aks-azulab-dev --overwrite-existing
kubectl get nodes
kubectl -n azulab get pods
```

Expected: one node `Ready`, two pods `Running`, both `1/1`.

Have these open in separate panes:
- browser: `http://<EXTERNAL-IP>/`
- terminal: this file
- editor: `k8s/deployment.yaml`, `infra/aks.tf`

---

## 1. "This is the cluster" (1 min)

```bash
kubectl get nodes -o wide
kubectl -n azulab get deploy,rs,pods -o wide
```

Say:

> One node, Free tier control plane — a deliberate cost choice for a lab.
> Two replicas so a pod can die without an outage.

---

## 2. "This is the artifact" (1 min)

```bash
kubectl -n azulab get deploy azulab -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

Say:

> The same image tag that Container Apps is running. One CI pipeline, two
> runtimes. The tag is an immutable commit SHA, never `latest`.

---

## 3. "No secrets in the cluster" (2 min)

```bash
kubectl -n azulab get sa azulab -o yaml | grep -A2 annotations
kubectl -n azulab get pod -l app.kubernetes.io/name=azulab -o jsonpath='{.items[0].spec.containers[0].env[*].name}{"\n"}'
kubectl -n azulab exec deploy/azulab -- env | grep -E 'AZURE_(CLIENT_ID|FEDERATED_TOKEN_FILE)'
```

Say:

> There is no Secret object. The ServiceAccount is annotated with the managed
> identity client id; the pod is labelled for the Workload Identity webhook.
> Kubernetes projects a short-lived token, Entra ID exchanges it. Nothing to
> leak, nothing to rotate.

Show `infra/aks.tf` → the federated credential subject:

> `system:serviceaccount:azulab:azulab` — that string is the entire trust
> relationship. If I rename the namespace or the ServiceAccount, it breaks.

---

## 4. "Readiness is real" (2 min)

```bash
IP=$(kubectl -n azulab get svc azulab -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl -s http://$IP/version
curl -s http://$IP/ready
```

Say:

> `/ready` checks Blob Storage with a 2-second timeout. If Storage is down, the
> pod leaves the rotation but is **not** restarted — because liveness checks
> only the process.

---

## 5. "Load balancing is visible" (1 min)

```bash
for i in $(seq 1 10); do curl -s -o /dev/null -D - http://$IP/health | awk 'tolower($1)=="x-pod-name:"{print $2}'; done | sort | uniq -c
```

Say:

> Two different pod names. The Service is spreading requests across replicas.

---

## 6. "Zero-downtime rollout" (3 min)

```bash
( while true; do curl -s -o /dev/null -w "%{http_code}\n" http://$IP/health; sleep 0.2; done ) > /tmp/hc.log &
kubectl -n azulab rollout restart deploy/azulab
kubectl -n azulab rollout status deploy/azulab
kill %1
sort /tmp/hc.log | uniq -c
```

Say while it runs:

> `maxUnavailable: 0` means a new pod must be Ready before an old one is
> terminated. `preStop: sleep 5` gives kube-proxy time to stop sending traffic
> before SIGTERM. The app also drains gracefully on SIGTERM.

Expected: `200` only. No `502`, no `503`.

---

## 7. "Failure is contained" (2 min)

```bash
curl -s -X POST "http://$IP/debug/fail-readiness?value=true&ttl=30"
kubectl -n azulab get endpoints azulab
kubectl -n azulab get pods
```

Say:

> The pod reports `NotReady`; Kubernetes removes it from the endpoints. Users
> see no error because the other replica is still serving. The container was
> not restarted — this is readiness, not liveness.

Watch it heal itself (the override is time-bounded, 30 seconds here):

```bash
kubectl -n azulab get endpoints azulab -w
```

Say:

> A permanent switch would be a trap: once the pod leaves the Service, the load
> balancer cannot reach it to switch the flag back off. The `ttl` makes the
> experiment self-healing, like a bounded chaos run.

If you want to target one specific pod instead of whichever replica the LB
picks:

```bash
POD=$(kubectl -n azulab get pods -o jsonpath='{.items[0].metadata.name}')
kubectl -n azulab exec $POD -- wget -qO- --post-data='' "localhost:8080/debug/fail-readiness?value=true&ttl=30"
```

> This endpoint exists only because `ENABLE_DEBUG_ENDPOINTS=true` in this lab.
> In production it is off by default — a public switch that drains replicas is
> a denial-of-service vector.

---

## 8. "Rollback" (1 min)

```bash
kubectl -n azulab rollout history deploy/azulab
kubectl -n azulab rollout undo deploy/azulab
kubectl -n azulab rollout status deploy/azulab
```

Say:

> ReplicaSets are immutable snapshots. Rollback is a pointer move, not a
> rebuild.

---

## 9. "What I would change for production" (1 min)

Say, in this order:

1. 3 nodes across availability zones, Standard tier control plane (SLA).
2. Azure CNI Overlay + NetworkPolicy; private API server.
3. Ingress with TLS instead of one LoadBalancer per Service.
4. HPA + cluster autoscaler; requests/limits tuned from real metrics.
5. Azure Policy for AKS + Defender for Containers; image scanning in CI.
6. GitOps (Argo CD or Flux) instead of `kubectl set image`.

---

## Fallbacks

| Problem | Immediate fix |
| --- | --- |
| `kubectl` points at localhost:8080 | `az aks get-credentials ... --overwrite-existing` |
| LB IP empty | `kubectl -n azulab get svc azulab -w` (2–4 min), check `kubectl describe svc` |
| Pods Pending | `kubectl describe node` → Allocated resources; reduce replicas to 1 |
| `ImagePullBackOff` | confirm the GHCR tag exists; check the pod events |
| 503 everywhere | `kubectl get endpoints azulab` → empty means readiness is failing |
| Workload Identity 401 | compare federated credential subject with namespace/SA |
