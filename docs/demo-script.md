# Demo script — Azulab Drop on AKS

Target: 12–15 minutes. Every command has a one-line "what to say" next to it.
Run from the repository root. The UI is the visual anchor; the commands are the
proof behind each card.

```bash
export AKS=$(kubectl -n azulab get svc azulab -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
export ACA=https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io
echo "AKS http://$AKS/"
```

---

## 0. Pre-flight (15 minutes before the call)

```bash
# Cluster stopped after the last session? Start it now (3-5 minutes).
az aks show -g rg-azulab-dev-polandcentral -n aks-azulab-dev --query powerState.code -o tsv
az aks start -g rg-azulab-dev-polandcentral -n aks-azulab-dev

az aks get-credentials -g rg-azulab-dev-polandcentral -n aks-azulab-dev --overwrite-existing
kubectl get nodes
kubectl -n azulab get pods
kubectl -n azulab get hpa azulab

# Teardown deletes the Service; recreate only it (not the whole kustomization,
# which would roll the image back to the baseline tag).
kubectl -n azulab get svc azulab || kubectl apply -f k8s/service.yaml

IP=$(kubectl -n azulab get svc azulab -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "http://$IP/"
curl -s "http://$IP/health"
curl -s "http://$IP/ready"
curl -s "http://$IP/version"
curl -s "http://$IP/api/config" | jq '{store,keyVault,keyVersion,keyFingerprint}'

# Warm Container Apps (min_replicas = 0) and confirm the login boundary.
curl -s -o /dev/null -w "ACA /health %{http_code}\n" "$ACA/health"
curl -s -o /dev/null -w "ACA /       %{http_code}\n" "$ACA/"
```

Expected: one node `Ready`, two pods `1/1 Running`, HPA `MINPODS 2 / MAXPODS 6`,
`store: azure`, `keyVault: keyvault`, ACA `/health` 200 and `/` 401.

Have these open:
- browser: `http://<EXTERNAL-IP>/` on the **Drop** chapter
- terminal: this file
- editor: `k8s/deployment.yaml`, `k8s/hpa.yaml`, `infra/main.tf`

---

## 1. Drop — the product works (3 min)

In the browser:

1. Upload a small file (the prepared `docs/azulab-interview-pack.md` is fine).
2. Leave **Seal automatically** checked; wait for the toast and the `SEALED` badge.
3. Click **Share** on the newest drop, then **Open** the signed link.
4. Back in the catalogue, click **Verify**.

Equivalent commands:

```bash
printf 'Azulab demo %s\n' "$(date -u +%FT%TZ)" > /tmp/azulab-demo.txt
META=$(curl -s -X POST "http://$AKS/api/drops" \
  -H 'content-type: text/plain' -H 'x-filename: azulab-demo.txt' \
  --data-binary @/tmp/azulab-demo.txt)
ID=$(echo "$META" | jq -r .id)
echo "id=$ID"

curl -s -X POST "http://$AKS/api/drops/$ID/seal" | jq '{ms,iterations,pod}'
SHARE=$(curl -s -X POST "http://$AKS/api/drops/$ID/share" \
  -H 'content-type: application/json' -d '{"ttlSeconds":900}')
URL=$(echo "$SHARE" | jq -r .url)
echo "$URL"
echo "key=$(echo "$SHARE" | jq -r .keyVersion)"

curl -s "http://$AKS/api/drops/$ID/verify" | jq
curl -s "$URL" | sha256sum
```

Say:

> This is the product: a file, a seal and a link. The upload is raw bytes; the
> blob name is always `file`, and the original name is metadata. The seal is
> SHA-256 plus 600,000 PBKDF2 iterations — real CPU, roughly a third of a core
> second. The link is an HMAC over the drop id, the expiry and the key version.

Tamper and expiry (the two failure modes of a signed link):

```bash
TAMPERED=${URL/sig=/sig=AAAA}
EXPIRED="http://$AKS/s/$ID?exp=1&v=$(echo "$SHARE" | jq -r .keyVersion)&sig=x"
curl -s -o /dev/null -w "tampered %{http_code}\n" "$TAMPERED"   # 403
curl -s -o /dev/null -w "expired  %{http_code}\n" "$EXPIRED"    # 410
```

Say:

> Expiry is checked before the signature: an expired link is 410, not 403. A
> tampered signature is 403. Neither path needs a session or a database.

---

## 2. Blob — storage without a key (2 min)

In the browser: **02 Blob** → **Refresh stats**, **Write 20**, **Soft-delete
round trip**. Then point at the **Protection** and **Lifecycle** cards.

```bash
curl -s "http://$AKS/api/blob/stats" | jq
curl -s -X POST "http://$AKS/api/blob/bulk" \
  -H 'content-type: application/json' -d '{"count":20}' | jq
curl -s -X POST "http://$AKS/api/blob/soft-delete-demo" | jq

az storage container list --account-name stazulabdev6mvarl --auth-mode login -o table
az storage account management-policy show \
  --account-name stazulabdev6mvarl \
  --resource-group rg-azulab-dev-polandcentral -o json \
  | jq '.policy.rules[] | {name, enabled, prefix: .definition.filters.prefixMatch, cool: .definition.actions.baseBlob.tierToCool.daysAfterCreationGreaterThan, delete: .definition.actions.baseBlob.delete.daysAfterCreationGreaterThan}'
```

Say:

> The container is private and shared-key auth is disabled. The app reads and
> writes with its managed identity, so there is no account key in the pod. The
> soft-delete demo uploads, deletes, lists the deleted blob and undeletes it.
> The lifecycle rule is the only growth bound: Cool after 30 days, delete after
> 90. Three blobs per drop: `file`, `meta.json`, `seal.json`.

Optional proof that the human is not data plane:

```bash
az storage blob list --account-name stazulabdev6mvarl \
  --container-name drops --auth-mode login
# 403 — Owner is control plane, not data plane
```

---

## 3. RBAC — identity, not keys (2 min)

In the browser: **03 RBAC** → **Run all three probes**. Expect:

- Key Vault read secret: **200**
- Blob list container: **200**
- Storage list account keys: **403**

```bash
for action in read-secret read-blob list-keys; do
  curl -s -X POST "http://$AKS/api/probe" \
    -H 'content-type: application/json' -d "{\"action\":\"$action\"}" \
    | jq -c '{action,ok,status,code,detail}'
done

az role assignment list --assignee "$(curl -s http://$AKS/api/self | jq -r .oid)" --all -o table
```

Say:

> The pod authenticates with Workload Identity: Kubernetes projects a
> short-lived token, Entra exchanges it. The runtime has Key Vault Secrets User
> on one vault and Storage Blob Data Contributor on one account. It deliberately
> lacks `listKeys` on the storage account, so a compromised pod cannot export
> the account key. Groups hold the human assignments; the pipeline has zero
> direct roles and inherits Contributor from the deployers group.

---

## 4. Key Vault — rotate, then revoke on purpose (2 min)

In the browser: **04 Key Vault** → **Refresh key state**. Point at `VERSION`,
`FINGERPRINT`, `CURRENT-VERSION TTL` and `VERSION RECHECK`.

```bash
curl -s "http://$AKS/api/config" | jq '{keyVault,keyVersion,keyFingerprint,keyLoadedAt}'
az keyvault secret list-versions --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key --query "[].{id:id,enabled:attributes.enabled}" -o table
```

Rotation (safe while serving):

```bash
NEW=$(openssl rand -base64 48)
az keyvault secret set --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key --value "$NEW" >/dev/null
unset NEW
# Read the new version from the secret id (the CLI's --query properties.version is empty):
az keyvault secret list-versions --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key -o json \
  | jq -r 'sort_by(.attributes.created)[-1].id | split("/")[-1]'
```

Say:

> The old link still works after rotation because its URL names the version it
> was signed with. New links use the new version. The current version is re-read
> every five minutes; old versions stay cached.

Revocation (the part that makes "disable" real):

```bash
OLD=<old-version-from-the-table>
az keyvault secret set-attributes --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key --version "$OLD" --enabled false
# Poll the old link: 403 within 60 s.
# Then restore it:
az keyvault secret set-attributes --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key --version "$OLD" --enabled true
```

Say:

> A cached version is re-checked at most every 60 seconds. Disabling it answers
> 403/404, the cache entry is dropped, and its links stop verifying. A vault
> outage is treated differently: the cached key keeps working, marked stale, so
> an outage does not mass-revoke valid links. That is the difference between
> revocation and an incident.

Measured evidence: `docs/evidence/verification-2026-11-04.txt` — 28 samples at
200 over 58 seconds, then 403 at t+61s on the same pod.

---

## 5. Scaling — real CPU, real replicas (2 min)

In the browser: **05 Scaling** → **Observe 20 requests** → **Run 12s of seals**.
Then watch the HPA:

```bash
kubectl -n azulab get hpa azulab -w
kubectl -n azulab top pods
```

Expected: the UI load shows two pod names and moves CPU above the 60% target; a
short run usually takes replicas 2 → 3. For the ceiling, burn CPU for 120 seconds:

```bash
POD=$(kubectl -n azulab get pods -o jsonpath='{.items[0].metadata.name}')
kubectl -n azulab exec "$POD" -- timeout 120 sh -c 'yes > /dev/null' &
# In another pane:
kubectl -n azulab get hpa azulab -w
```

Say:

> Requests are 100m, limits 300m, target 60% of the request, min 2, max 6. The
> seal is PBKDF2 on the libuv threadpool, so the event loop keeps answering while
> the CPU is saturated. That matters: a blocking loop would fail readiness before
> the HPA could add a pod. The node is a single 2-vCPU D2as_v5, so the HPA adds
> pods but the node is the ceiling. Measured: 2 → 6 → 2.

---

## 6. Cost — small by design (1 min)

In the browser: **06 Cost** → **The bill** and **Levers**.

```bash
az consumption usage list --top 5 --query "[].{name:instanceName,cost:pretaxCost,currency:currency}" -o table
az storage account management-policy show \
  --account-name stazulabdev6mvarl \
  --resource-group rg-azulab-dev-polandcentral -o json \
  | jq '.policy.rules[] | {name, prefix: .definition.filters.prefixMatch, cool: .definition.actions.baseBlob.tierToCool.daysAfterCreationGreaterThan, delete: .definition.actions.baseBlob.delete.daysAfterCreationGreaterThan}'
```

Say:

> About 2.93 $/day all-in: one node (2.21), one LoadBalancer (0.60) and its
> public IP (0.12) dominate. Container Apps is zero at idle because it scales to
> zero. The 50 $ budget alert is an early warning, not a cap — it fires after
> roughly 17 days of continuous runtime. The levers are: one node, no ACR, ACA
> scale-to-zero, delete the Service between sessions, stop the cluster, and a
> lifecycle rule on the only growing container. Blob retention is bounded at 90
> days; the demo cannot quietly accumulate cost.

---

## 7. Availability — failure is a feature (2 min)

In the browser: **07 Availability** → **Drain this pod (60 s)**. Watch the
timeline and the ready endpoints. Then explain readiness vs liveness.

```bash
curl -s "http://$AKS/ready" | jq
kubectl -n azulab get endpointslice -l kubernetes.io/service-name=azulab \
  -o jsonpath='{range .items[*].endpoints[?(@.conditions.ready==true)]}{.addresses[*]}{"\n"}{end}'
kubectl -n azulab get pods
```

The endpoint override is time-bounded (the UI uses 60 s; the API accepts 5–600):

```bash
curl -s -X POST "http://$AKS/debug/fail-readiness?value=true&ttl=30"
```

Say:

> Readiness fails, the pod leaves the Service endpoints, and users see nothing
> because the other replica is still serving. The container is not restarted —
> that is readiness, not liveness. The override is time-bounded because a
> permanent switch would be a trap: once the pod is out of the Service, the load
> balancer cannot reach it to switch the flag back. The PDB is `minAvailable: 1`,
> and the rollout is `maxSurge 1 / maxUnavailable 0`. Two replicas on one node
> share the node's fate; zone redundancy was declined on cost.

Optional crash (the UI button does this against the pod that served the page):

```bash
curl -s -X POST "http://$AKS/debug/crash"
```

---

## 8. Delivery — one image, two runtimes (2 min)

In the browser: **08 Delivery** → artifact card and the AKS/ACA comparison.
Then prove the same tag on both:

```bash
curl -s "http://$AKS/version" | jq '{version,image,pod}'
az containerapp show -g rg-azulab-dev-polandcentral -n ca-azulab-dev \
  --query 'properties.template.containers[0].image' -o tsv

curl -s -o /dev/null -w "ACA /     %{http_code}\n" "$ACA/"          # 401
curl -s -o /dev/null -w "ACA /health %{http_code}\n" "$ACA/health"  # 200
```

Cross-runtime signed link (the same URL, no session):

```bash
SHARE=$(curl -s -X POST "http://$AKS/api/drops/$ID/share" \
  -H 'content-type: application/json' -d '{"ttlSeconds":900}')
URL=$(echo "$SHARE" | jq -r .url)
PATHQ=${URL#http://$AKS}
curl -s -o /tmp/from-aks.bin -w "AKS %{http_code}\n" "$URL"
curl -s -o /tmp/from-aca.bin -w "ACA %{http_code}\n" "$ACA$PATHQ"
sha256sum /tmp/from-aks.bin /tmp/from-aca.bin
```

Say:

> Every merge to main produces one immutable artifact. Container Apps and AKS
> pull the same tag, so "it works on my machine" is the same machine. Easy Auth
> protects the Container App root with Entra ID, but `/s/*` stays anonymous:
> the HMAC in the URL is the credential. That is why the same signed link
> downloads byte-identical content from both runtimes.

---

## 9. "What I would change for production" (1 min)

Say, in this order:

1. Three nodes across availability zones; Standard tier control plane (SLA).
2. Ingress with TLS instead of one LoadBalancer per Service.
3. Cluster autoscaler and tuned requests/limits from real metrics.
4. Azure CNI Overlay + NetworkPolicy; private API server.
5. Defender for Containers + image scanning (Trivy) in CI; SBOM.
6. GitOps (Argo CD or Flux) instead of `kubectl set image`.
7. Managed identity for the human path via PIM, not standing Owner.

---

## Fallbacks

| Problem | Immediate fix |
| --- | --- |
| `kubectl` points at localhost:8080 | `az aks get-credentials ... --overwrite-existing` |
| LB IP empty | `kubectl -n azulab get svc azulab -w` (2–4 min), check `kubectl describe svc` |
| Pods Pending | `kubectl describe node` → Allocated resources; the HPA may have scaled during a previous demo |
| `ImagePullBackOff` | confirm the GHCR tag exists; check the pod events |
| 503 everywhere | `kubectl get endpointslice` → empty means readiness is failing |
| Drop 503 | `/api/config` → `store` must be `azure`; check `/ready` |
| Link 403 | compare `v=` with `/api/config`; the version may be disabled |
| Workload Identity 401 | compare federated credential subject with namespace/SA |
| HPA stuck at max | a previous burn is still running; wait for the 60 s stabilization |
