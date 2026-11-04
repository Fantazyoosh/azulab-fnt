# Entra ID login on Container Apps (Easy Auth)

The Container App requires an Entra ID sign-in. The AKS deployment stays public:
Container Apps is the "identity" demo, AKS is the "orchestration" demo.

```
browser ──► https://ca-azulab-dev…/
              │  no session
              ▼
        /.auth/login/aad ──► login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize
              │  sign in
              ▼
        /.auth/login/aad/callback ──► session cookie ──► app
```

`/health` and `/ready` are excluded so probes and the CD smoke test keep working.
`/s/*` is also excluded: a signed share link carries its own HMAC credential and
must work without a session. Everything else (`/`, `/api/*`, `/version`) returns
`401` without a session.

---

## What exists

| Object | Value |
| --- | --- |
| App registration | `azulab-web` (`adc8c8ac-0205-4931-99c0-515ad3d6ce33`) |
| Sign-in audience | single tenant (`AzureADMyOrg`) |
| Redirect URI | `https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io/.auth/login/aad/callback` |
| Client secret | Container App secret `microsoft-provider-authentication-secret`, created by the Easy Auth command (not in Git, not in Terraform) |
| Excluded paths | `/health`, `/ready`, `/s/*` |
| Unauthenticated action | `RedirectToLoginPage` for browsers; `401` for API clients |

The whole setup is reproducible with [`scripts/setup-easy-auth.sh`](../scripts/setup-easy-auth.sh).

## Why a client secret (the honest trade-off)

Container Apps Easy Auth is a **confidential client**: it needs a client secret or
a certificate. There is no managed-identity option in the auth config.

- The secret is stored in the Container App secret store (encrypted at rest,
  managed by Azure), not in Git and not in Terraform state.
- The Container App resource ignores `secret` changes
  (`lifecycle.ignore_changes`), so a plan never deletes the Easy Auth secret.
- It rotates annually; re-running the script rotates it immediately.
- A certificate is the stronger alternative, at the cost of managing a
  certificate lifecycle.

This is the one place in the project where a long-lived credential exists. Every
other path (CI/CD, the app's data access) is secret-less. Say that out loud — it
shows the difference between "no secrets" as a principle and the platform
constraint you accepted knowingly.

## Verify

```bash
FQDN=ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io

curl -s -o /dev/null -w "health=%{http_code}\n"  "https://$FQDN/health"   # 200
curl -s -o /dev/null -w "ready=%{http_code}\n"   "https://$FQDN/ready"    # 200
curl -s -o /dev/null -w "app=%{http_code}\n"     "https://$FQDN/"         # 401
curl -s -o /dev/null -w "login=%{http_code}\n"   "https://$FQDN/.auth/login/aad"  # 302

az containerapp auth show -g rg-azulab-dev-polandcentral -n ca-azulab-dev \
  --query "{action:globalValidation.unauthenticatedClientAction, excluded:globalValidation.excludedPaths, clientId:identityProviders.azureActiveDirectory.registration.clientId}" -o json
```

## Disable

```bash
az containerapp auth update -g rg-azulab-dev-polandcentral -n ca-azulab-dev --enabled false
```

The app becomes public again immediately; the app registration and secret stay in
place for the next demo.

## What the app sees

Easy Auth terminates the session and forwards the request with identity headers
(`X-MS-CLIENT-PRINCIPAL-*`). The Node.js code does not validate tokens — it does
not need to. If you ever need per-user authorization, read
`X-MS-CLIENT-PRINCIPAL` and map the object id to an application role.

## Why not on AKS too

AKS would need an ingress with an OIDC proxy (oauth2-proxy or an ingress
controller with forward auth). That is a different lesson and a different failure
mode. Keeping AKS public makes the zero-downtime and load-balancing demos
reachable from any device without a login.
