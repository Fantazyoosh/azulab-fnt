# 🛡️ Security Architecture

Zero-Trust in this project means: no component is trusted because of *where* it
runs. Every access is an identity presenting a short-lived token to a resource
that checks a role assignment. There is no password anywhere in the chain.

---

## 1. Trust chain

### GitHub Actions → Azure (OIDC)
- App registration `azulab-github-oidc`, no client secret.
- Three federated credentials restrict the trust to this repository:
  - `refs/heads/main`
  - the `production` environment
  - a repository-scoped subject
- **Role: `Contributor` on `rg-azulab-dev-polandcentral` only.** It used to be
  subscription-wide; narrowing it means a compromised pipeline can damage one
  resource group, not the whole subscription.
- Audience: `api://AzureADTokenExchange`.

### Workload → Azure (identity)
- One **user-assigned managed identity** (`id-azulab-dev-app`) serves both
  runtimes.
- Container Apps: the platform projects the identity into the container.
- AKS: **Workload Identity**. The ServiceAccount is annotated with the client id,
  the pod carries `azure.workload.identity/use: "true"`, and the webhook projects
  a short-lived token into the pod. A federated credential on the identity binds
  it to:
  - issuer: the AKS OIDC issuer URL
  - subject: `system:serviceaccount:azulab:azulab`
  - audience: `api://AzureADTokenExchange`
- In Kubernetes the deployment sets `AZURE_TOKEN_CREDENTIALS=WorkloadIdentityCredential`,
  so the SDK uses exactly one credential source instead of probing IMDS or the CLI.

### What does not exist
- No `Secret` object in the cluster.
- No client secret in GitHub.
- No storage account key (see below).
- No password in the image or in environment variables.

---

## 2. Role assignments (least privilege)

| Principal | Role | Scope | Why |
| --- | --- | --- | --- |
| GitHub OIDC app | `Contributor` | resource group | deploy Container Apps |
| App managed identity | `Key Vault Secrets User` | the vault | read one secret |
| App managed identity | `Storage Blob Data Contributor` | the storage account | read/write the message blob |
| Deploying user | `Key Vault Administrator` | the vault | bootstrap the first secret |

No principal has subscription-wide access any more.

---

## 3. Storage hardening

| Control | Value | Reason |
| --- | --- | --- |
| `shared_access_key_enabled` | **false** | no account master key exists to leak |
| `allow_nested_items_to_be_public` | false | blobs cannot be made anonymous |
| `min_tls_version` | TLS1_2 | rejects old clients |
| `https_traffic_only_enabled` | true | no plaintext transport |
| `network_rules` | optional IP allow-list | additive, off by default |

Consequence for operators: the Terraform provider authenticates with Entra ID
(`storage_use_azuread = true`), and CLI commands need `--auth-mode login`.
Disabling the key without that flag produces
`403 KeyBasedAuthenticationNotPermitted` on the next plan — a lesson recorded in
the runbook.

---

## 4. Key Vault hardening

| Control | Value |
| --- | --- |
| Authorization model | Azure RBAC (not access policies) |
| Purge protection | **enabled** |
| Soft delete | 7 days |

Purge protection means a deleted secret or vault cannot be permanently destroyed
before the retention window ends — an attacker (or a tired operator) cannot make
the data unrecoverable. Seven days is deliberate: it is enough for a lab and does
not reserve the vault name for 90 days after teardown.

`soft_delete_retention_days` cannot be changed after creation; the plan fails if
you try.

---

## 5. Observability as a security control

A control you cannot audit is not a control. Diagnostic settings send:

- Key Vault: all logs + all metrics → `law-azulab-dev`
- Blob service: `StorageWrite` and `StorageDelete` → `law-azulab-dev`

`StorageRead` is intentionally excluded: every message read would be logged, which
adds cost without adding signal in this lab.

This is what makes "who deleted the secret?" or "who wrote that blob?" answerable.

---

## 6. Summary

| Threat | Legacy approach | Azulab approach | Effect |
| --- | --- | --- | --- |
| Credential leak | secret in GitHub Secrets | OIDC federation | nothing to leak |
| Identity theft | username/password | managed identity / workload identity | no password to steal |
| Over-privilege | subscription Contributor | Contributor on one resource group | bounded blast radius |
| Storage key leak | account key in config | shared key disabled | no key exists |
| Secret destruction | soft delete only | purge protection | irreversible deletion blocked |
| Blind spots | no audit trail | diagnostic settings to Log Analytics | access is auditable |
| Compromised pod | node-wide identity | per-pod federated identity | pod can only read its own role scope |

---

## 7. Verification

```bash
# OIDC app scope
az role assignment list --assignee 112c715b-6e39-47d8-bad5-1a5065751990 --all -o table

# application identity roles
az role assignment list --assignee 65833aeb-6950-49aa-afd3-0238675727f7 --all -o table

# storage: no key auth
az storage account show -n stazulabdev6mvarl -g rg-azulab-dev-polandcentral \
  --query allowSharedKeyAccess

# key vault: purge protection on
az keyvault show -n kv-azulab-dev-6mvarl \
  --query '{purge:properties.enablePurgeProtection, softDelete:properties.softDeleteRetentionDays}'

# workload identity inside the pod
kubectl -n azulab exec deploy/azulab -- env | grep AZURE_
```

---

## 8. Known gaps (conscious)

| Gap | Impact | Production fix |
| --- | --- | --- |
| Public AKS API server | internet-exposed control plane | private cluster + private DNS |
| AKS local accounts enabled | `get-credentials` yields cluster-admin | `local_accounts_enabled = false` + Azure RBAC for Kubernetes |
| No private endpoints | traffic over Microsoft backbone, public endpoints | private endpoint for KV and Storage |
| No WAF / geo-blocking | no edge filtering | Front Door + WAF policy |
| No image scanning | vulnerable base image could ship | Trivy in CI + Defender for Containers |
