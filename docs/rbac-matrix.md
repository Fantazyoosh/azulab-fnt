# RBAC matrix

Who can do what, on which scope, and how to verify it. Scope matters more than
role name: `Contributor` on a resource group is a very different risk from
`Contributor` on a subscription.

| Principal | Type | Role | Scope | Can do | Cannot do |
| --- | --- | --- | --- | --- | --- |
| `maciej.waszkiewicz@me.com` | user | `Owner` | subscription | everything (lab owner) | — |
| `maciej.waszkiewicz@me.com` | user | `Key Vault Administrator` | the vault | bootstrap and rotate secrets | manage other vaults |
| `maciej.waszkiewicz@me.com` | user | `Storage Blob Data Contributor` | `stazulabtfstate6mvarl` (Terraform state) | read/write the state blob | read application blobs (different account) |
| `azulab-github-oidc` | app registration | `Contributor` | resource group | deploy Container Apps | touch other resource groups, assign roles |
| `id-azulab-dev-app` | user-assigned managed identity | `Key Vault Secrets User` | the vault | read secret values | write, delete, change permissions |
| `id-azulab-dev-app` | user-assigned managed identity | `Storage Blob Data Contributor` | the storage account | read/write blobs | change network rules, delete the account |
| `aks-azulab-dev` cluster identity | system-assigned managed identity | `Contributor` | `MC_…_swedencentral` (node RG) | manage node infrastructure | access the application resource group |
| AKS kubelet identity | managed identity | *none* | — | — | — |

## Why the kubelet identity has no roles

The usual `AcrPull` assignment exists only when the cluster pulls from ACR. This
project pulls a **public** image from GHCR, so no registry permission is needed.
Adding ACR would mean one more role and one more credential path for no demo
value.

## Control plane vs data plane

`Contributor` is a **control-plane** role: it can create and configure resources
but cannot read blob contents or secret values. That is why the application needs
explicit **data-plane** roles (`Key Vault Secrets User`, `Storage Blob Data
Contributor`) even though the deploying user is Owner.

This distinction is the answer to "why not just give the app Contributor?" — it
would still not be able to read the secret, and it would be able to delete the
vault.

## Blast radius

| If this is compromised | Worst case |
| --- | --- |
| GitHub pipeline | deploy a malicious image into one resource group |
| Application pod | read one secret, read/write blobs in one account |
| Storage account key | **cannot happen** — shared key auth is disabled |
| Cluster identity | modify node infrastructure in the AKS-managed RG |

## Verification

```bash
# pipeline identity
az role assignment list --assignee 112c715b-6e39-47d8-bad5-1a5065751990 --all -o table

# application identity
az role assignment list --assignee 65833aeb-6950-49aa-afd3-0238675727f7 --all -o table

# what the pod actually sees
kubectl -n azulab exec deploy/azulab -- env | grep AZURE_CLIENT_ID
```

## Kubernetes-side RBAC

The application does not use the Kubernetes API, so its ServiceAccount has no
`Role` or `RoleBinding`. It exists **only** as a Workload Identity subject
(`system:serviceaccount:azulab:azulab`). The default ServiceAccount token is
still mounted, but it grants no permissions.

What the ServiceAccount *does* get is a federated Azure identity. That is the
whole point: identity at the pod level, without Kubernetes API privileges.
