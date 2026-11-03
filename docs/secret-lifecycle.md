# Secret lifecycle

There are two kinds of "secret" in this project, and neither is stored where an
attacker would look first.

| Secret | Where it lives | Who can read it |
| --- | --- | --- |
| Application message | Azure Key Vault (`app-message`) | the app identity, via RBAC |
| Azure credentials | **nowhere** | nobody — they do not exist |

---

## 1. The application secret

### Bootstrap (once, outside Terraform)

Terraform used to own the secret *value*, which meant a secret in Git. It no
longer does: the resource was removed from state with
`removed { lifecycle { destroy = false } }`, so the value stayed in Key Vault
while Terraform forgot about it.

```bash
az keyvault secret set \
  --vault-name kv-azulab-dev-6mvarl \
  --name app-message \
  --value "hello from azulab key vault"
```

### Read at startup

1. The pod starts with `KEY_VAULT_URL` and `SECRET_NAME` in its environment.
2. It builds a credential:
   - Container Apps: the managed identity attached to the app.
   - AKS: `WorkloadIdentityCredential` using the projected token.
3. `SecretClient.getSecret()` returns the value.
4. The value is cached **in memory** for the life of the process.
5. `/ready` reports `keyVault: "ok"` only after the secret is loaded.

### Failure handling

| Failure | Behaviour |
| --- | --- |
| Key Vault slow at startup | retry 5 times, backoff 1→16 s |
| Key Vault unreachable | process stays alive, `/ready` = 503, `/health` = 200 |
| Secret missing | same as unreachable; the error is logged with the vault name |
| Storage unreachable | `/ready` = 503 after two consecutive failures (flap protection) |

The last two rows are the reason liveness never checks dependencies: a dependency
outage must drain traffic, not restart every replica.

### Rotation

```bash
az keyvault secret set --vault-name kv-azulab-dev-6mvarl \
  --name app-message --value "new value"

kubectl -n azulab rollout restart deploy/azulab
az containerapp revision restart -g rg-azulab-dev-polandcentral -n ca-azulab-dev \
  --revision "$(az containerapp show -g rg-azulab-dev-polandcentral -n ca-azulab-dev \
  --query properties.latestRevisionName -o tsv)"
```

**Known limitation:** the app reads the secret once at startup and caches it. It
does not watch Key Vault for new versions. A production system would either
restart on rotation (above) or use a short TTL cache with background refresh.

### Why the secret is not in Kubernetes

There is no `Secret` object in the `azulab` namespace. A Kubernetes Secret is
base64, not encryption, and it is readable by anyone with `get secrets` in the
namespace. Workload Identity removes the object entirely: the pod asks Entra ID
for a token, and Entra ID checks the federated credential.

---

## 2. The credentials that do not exist

### GitHub Actions → Azure

- No `AZURE_CLIENT_SECRET` in GitHub.
- Each workflow job gets a short-lived OIDC token from GitHub.
- Azure exchanges it for an access token, after validating:
  - issuer: `token.actions.githubusercontent.com`
  - subject: `repo:Fantazyoosh/azulab-fnt:ref:refs/heads/main` (or the
    `production` environment)
  - audience: `api://AzureADTokenExchange`
- The resulting token is scoped to the job and expires.

### Pod → Azure

- The kubelet projects a service-account token into
  `/var/run/secrets/azure/tokens/azure-identity-token`.
- The token is audience-bound and short-lived; the kubelet rotates it.
- Entra ID exchanges it using the federated credential whose subject is
  `system:serviceaccount:azulab:azulab`.

If someone copies the file out of the pod, it is useless outside the cluster and
expires quickly. There is no long-lived credential to steal.

---

## 3. What an attacker would find

| Target | Result |
| --- | --- |
| Git repository | no secret values (the value was removed from Terraform) |
| Container image | no credentials baked in |
| Kubernetes API | no Secret objects |
| Pod filesystem | a projected token file, valid briefly, audience-bound |
| Storage account | shared key disabled — no key to steal |
| Key Vault | needs an Entra token with `Key Vault Secrets User` |

The weakest point is the human with `Owner`, which is why the pipeline identity
was narrowed to a single resource group.
