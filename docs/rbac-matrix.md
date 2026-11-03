# RBAC matrix

Who can do what, on which scope, and through which group. Scope matters more
than role name: `Contributor` on a resource group is a very different risk from
`Contributor` on a subscription.

---

## 1. Entra ID groups hold the assignments

| Group | Members | Azure role | Scope |
| --- | --- | --- | --- |
| `azulab-platform-admins` | Maciej (user) | `Key Vault Administrator` | the vault |
| `azulab-deployers` | `azulab-github-oidc` (service principal) | `Contributor` | the resource group |
| `azulab-readers` | *(empty, onboarding path)* | `Reader` | the resource group |

The pipeline service principal has **zero direct role assignments**. It inherits
`Contributor` from `azulab-deployers`. The human has no direct role on the vault
either — access comes from `azulab-platform-admins`.

Onboarding is one membership change, not a tour of every resource. Offboarding is
the reverse.

## 2. Direct assignments (deliberate exceptions)

| Principal | Type | Role | Scope | Why direct |
| --- | --- | --- | --- | --- |
| `maciej.waszkiewicz@me.com` | user | `Owner` | subscription | lab owner; break-glass, not used for daily work |
| `maciej.waszkiewicz@me.com` | user | `Storage Blob Data Contributor` | Terraform state account | the backend needs data-plane access to read/write state |
| `id-azulab-dev-app` | managed identity | `Key Vault Secrets User` | the vault | runtime identity; narrow and managed by Terraform |
| `id-azulab-dev-app` | managed identity | `Storage Blob Data Contributor` | the storage account | runtime identity; narrow |
| `aks-azulab-dev` cluster identity | managed identity | `Contributor` | `MC_…_swedencentral` | created by AKS to manage its own node resource group |
| AKS kubelet identity | managed identity | *none* | — | no ACR: the image is public on GHCR |

Runtime identities stay direct on purpose: they are created and destroyed by
Terraform, have exactly one scope, and should not depend on group membership
propagation during a deploy.

## 3. Why groups (and what Entra ID Free does not give you)

The tenant has **no Entra ID P1/P2 licenses** (`subscribedSkus` is empty), so:

| Feature | Requires | Available here |
| --- | --- | --- |
| Security groups + group-based RBAC | Free | ✅ |
| App registrations, service principals, federated credentials | Free | ✅ |
| Conditional Access (MFA, location, device) | P1 | ❌ |
| PIM (time-bound `Owner`, approval) | P2 | ❌ |
| Access reviews | P2 | ❌ |

Compensating controls for the missing PIM:

- `Owner` is held by one human and is not used by automation.
- Everything else is scoped to a resource group or a single resource.
- The pipeline cannot read data and cannot assign roles.
- Membership in `azulab-platform-admins` is the only path to vault administration.

If the tenant gets P2, the next step is PIM on `azulab-platform-admins`: eligible,
not permanent, with approval and MFA.

## 4. Control plane vs data plane

`Contributor` is a **control-plane** role: it can create and configure resources
but cannot read blob contents or secret values. That is why:

- The pipeline has `Contributor` and still cannot read the secret.
- The human `Owner` cannot list blobs in the app storage account:

```bash
az storage blob list --account-name stazulabdev6mvarl \
  --container-name demo --auth-mode login
# 403 — Owner is control-plane
```

This distinction is the answer to "why not just give the app Contributor?" — it
would still not be able to read the secret, and it would be able to delete the
vault.

## 5. Blast radius

| If this is compromised | Worst case |
| --- | --- |
| GitHub pipeline | deploy a malicious image into one resource group |
| Application pod | read one secret, read/write blobs in one account |
| Storage account key | **cannot authenticate** — key-based auth is disabled |
| Cluster identity | modify node infrastructure in the AKS-managed RG |
| `azulab-platform-admins` membership | administer one vault |

## 6. Verification

```bash
# groups and members
az ad group list -o table
az ad group member check --group azulab-deployers --member-id <sp-object-id>

# role assignments per group
az role assignment list --assignee <group-object-id> --all -o table

# the pipeline must have no direct assignments
az role assignment list --assignee <sp-object-id> --all --query "length(@)"

# the human must not have a direct vault role
az role assignment list --assignee <user-object-id> --all -o table
```

## 7. Kubernetes-side RBAC

The application does not use the Kubernetes API, so its ServiceAccount has no
`Role` or `RoleBinding`. It exists **only** as a Workload Identity subject
(`system:serviceaccount:azulab:azulab`). The default ServiceAccount token grants
no permissions.

What the ServiceAccount does get is a federated Azure identity. That is the
point: identity at the pod level, without Kubernetes API privileges.
