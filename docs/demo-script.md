# Demo script — Kubernetes on AKS

Target: 12–15 minutes. Every command has a one-line "what to say" next to it.
Run from the repository root.

---

## 0. Pre-flight (15 minutes before the call)

```bash
# Cluster stopped after the last session? Start it now (3-5 minutes).
az aks show -g rg-azulab-dev-polandcentral -n aks-azulab-dev --query powerState.code -o tsv
az aks start -g rg-azulab-dev-polandcentral -n aks-azulab-dev

az aks get-credentials -g rg-azulab-dev-polandcentral -n aks-azulab-dev --overwrite-existing
kubectl get nodes
kubectl -n azulab get pods

# Teardown deletes the Service; recreate only it (not the whole kustomization,
# which would roll the image back to the baseline tag).
kubectl -n azulab get svc azulab || kubectl apply -f k8s/service.yaml

IP=$(kubectl -n azulab get svc azulab -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "http://$IP/"
curl -s "http://$IP/health"
curl -s "http://$IP/ready"
```

Expected: one node `Ready`, two pods `Running`, both `1/1`, and a new public IP
(the LoadBalancer IP changes when the Service is recreated).

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

## 2b. "Roles come from groups" (1 min)

```bash
DEPLOYERS=$(az ad group list --query "[?displayName=='azulab-deployers'].id | [0]" -o tsv)
SP=$(az ad sp show --id 112c715b-6e39-47d8-bad5-1a5065751990 --query id -o tsv)

echo "direct assignments for the pipeline: $(az role assignment list --assignee "$SP" --all --query 'length(@)' -o tsv)"
az role assignment list --assignee "$DEPLOYERS" --all -o table
az ad group member check --group "$DEPLOYERS" --member-id "$SP"
```

Say:

> The pipeline has zero direct role assignments. It inherits Contributor from the
> deployers group. Onboarding is a membership change; offboarding is one command.
> The same pattern covers my vault access through the admins group.

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

## 3b. "Prove it with the audit log" (optional, 1 min)

```bash
WS=$(az monitor log-analytics workspace show -g rg-azulab-dev-polandcentral \
  -n law-azulab-dev --query customerId -o tsv)
az monitor log-analytics query -w "$WS" --analytics-query \
"AzureDiagnostics
 | where ResourceType == 'VAULTS'
 | where OperationName in ('SecretGet','SecretList')
 | project TimeGenerated, OperationName, ResultType, CallerIPAddress, identity_claim_oid_g
 | order by TimeGenerated desc
 | take 10" -o table
```

Say:

> This is the Key Vault audit trail. The OID is the managed identity's principal
> id, the IP is the AKS or Container Apps egress, and the result is Success.
> That is how I answer "who read the secret?" without guessing.

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
kubectl -n azulab get endpointslice -l kubernetes.io/service-name=azulab \
  -o jsonpath='{range .items[*].endpoints[?(@.conditions.ready==true)]}{.addresses[*]}{"\n"}{end}'
kubectl -n azulab get pods
```

> Use the ready-only filter, not `kubectl get endpoints`: the deprecated
> `Endpoints` object hides the detail, and an unfiltered EndpointSlice still
> lists the address with `ready: false`. You want to show the *routable* set.

Say:

> The pod reports `NotReady`; Kubernetes removes it from the endpoints. Users
> see no error because the other replica is still serving. The container was
> not restarted — this is readiness, not liveness.

Watch it heal itself (the override is time-bounded, 30 seconds here):

```bash
while true; do
  kubectl -n azulab get endpointslice -l kubernetes.io/service-name=azulab \
    -o jsonpath='{range .items[*].endpoints[?(@.conditions.ready==true)]}{.addresses[*]}{"\n"}{end}'
  sleep 2
done   # Ctrl+C to stop
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

## 10. "User authentication" (optional, 1 min)

> The Container App is protected by Easy Auth with Entra ID. Open
> `https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io/`
> and it redirects to the tenant login; `/health` and `/ready` stay open for
> probes. AKS stays public so the orchestration demo works from any device.
> Same image, two access models.

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
