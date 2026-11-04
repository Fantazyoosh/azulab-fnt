# Secret lifecycle

There are three kinds of secret in this project. Only one of them is a
long-lived credential, and it belongs to the platform, not to the application.

| Secret | Where it lives | Who can touch it |
| --- | --- | --- |
| **Share signing key** | Key Vault (`share-signing-key`), versioned | runtime identity reads; admins rotate and disable versions |
| Legacy app message | Key Vault (`app-message`) | runtime identity reads |
| Azure credentials | **nowhere** | nobody — they do not exist |
| Easy Auth client secret | Container App secret store | the platform; rotated yearly |

---

## 1. The share signing key

Every share link is an HMAC over `id`, expiry and key version. The key is a
versioned Key Vault secret; its value is never written to disk, never returned by
the API and never rendered in the UI. The API exposes only the version and a
fingerprint.

### Bootstrap (once, outside Terraform)

```bash
az keyvault secret set \
  --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key \
  --value "$(openssl rand -base64 48)"
```

Terraform owns the vault, the role assignment and the diagnostic settings. It
does not own secret values: a value in Terraform state is a secret in Git.

### Read at runtime

1. The pod authenticates with its managed identity (Container Apps) or
   `WorkloadIdentityCredential` (AKS).
2. `SecretClient.getSecret(name, { version })` reads the exact version named in
   the link.
3. The current version is cached for **5 minutes**; every version is re-checked
   at most once every **60 seconds**.
4. `/ready` reports `keyVault: "ok"` and the version currently in use. A missing
   key makes readiness fail; the probe triggers a background refresh instead of
   blocking on Key Vault.

The UI in the **Key Vault** chapter shows:

- the secret name, never the value;
- the version and a short fingerprint;
- the current-version TTL and the version re-check bound.

### Rotation

```bash
NEW=$(openssl rand -base64 48)
az keyvault secret set \
  --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key \
  --value "$NEW"
unset NEW
```

This creates a new version. No redeploy is required:

- **new** shares use the new version within the 5-minute current-version TTL (or
  immediately after a pod restart);
- **old** links keep working because the URL names the version they were signed
  with;
- the old version stays available until it is disabled or deleted.

### Revocation

```bash
az keyvault secret set-attributes \
  --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key \
  --version <old-version> --enabled false
```

A disabled (or deleted) version answers `403`/`404`. The cache entry is dropped,
and every link carrying that version stops verifying. Because a cached version is
re-checked at most every 60 seconds, revocation is **bounded**, not instant.

Measured: `docs/evidence/verification-2026-11-04.txt` — the same pod answered
`200` for 58 seconds after the disable, then `403 key_unavailable` at t+61s.
Re-enabling the version restored the link.

### Failure handling

| Failure | Behaviour |
| --- | --- |
| Key Vault slow at startup | signing key loads lazily; `/ready` reports `pending` and retries in the background |
| Key Vault unreachable later | the cached key keeps working, marked `stale` — an outage must not mass-revoke valid links |
| Version disabled or deleted | `403`/`404`, cache entry dropped, the version's links fail |
| Secret missing at boot | `/ready` = 503; the process stays alive and `/health` = 200 |
| Storage unreachable | `/ready` = 503 after two consecutive failures (flap protection) |

The last rows are why liveness never checks dependencies: a dependency outage
must drain traffic, not restart every replica.

---

## 2. The legacy message secret

The original demo had a single `app-message` secret. The endpoint still exists,
but it is not part of the Drop product flow.

- It is read once at startup with five attempts and capped exponential backoff.
- It is cached for the life of the process.
- Rotating it requires a rollout restart, because the old code does not watch
  Key Vault. This is exactly the limitation the signing key was designed to
  avoid: the signing key is versioned, re-checked and revocable online.

---

## 3. Credentials that do not exist

### GitHub Actions → Azure

- No `AZURE_CLIENT_SECRET` in GitHub.
- Each workflow job gets a short-lived OIDC token from GitHub.
- Azure exchanges it for an access token after validating:
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

## 4. The one long-lived credential

Container Apps Easy Auth is a confidential client: it needs a client secret or a
certificate. The secret is stored in the Container App secret store, not in Git
and not in Terraform, and it rotates yearly. This is a platform constraint, not
an application choice; AKS has no equivalent because it has no ingress auth.

---

## 5. What an attacker would find

| Target | Result |
| --- | --- |
| Git repository | no secret values (Terraform does not own them) |
| Container image | no credentials baked in |
| Kubernetes API | no Secret objects |
| Pod filesystem | a projected token file, valid briefly, audience-bound |
| Storage account | shared key authentication disabled — a stolen key cannot authenticate |
| Key Vault | needs an Entra token with `Key Vault Secrets User`; the runtime cannot administer the vault |
| Share link | a signature bound to one drop, one expiry and one key version |

The weakest point is the human with `Owner`, which is why the pipeline identity
was narrowed to a single resource group and the runtime has no data-plane key.
