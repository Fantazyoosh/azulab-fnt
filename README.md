# azulab

A small, intentionally simple HTTP service used as a portfolio piece for an Azure +
CI/CD conversation. The point is not the app — it is the **end-to-end, defensible
delivery pipeline** around it: infrastructure as code, OIDC-based deployment with no
stored secrets, immutable image tags, scale-to-zero compute, Key Vault, RBAC, and a
documented rollback.

> Line kept on every artifact: *hands-on personal lab — not enterprise production.
> Here is exactly what it does and does not prove.*

## Architecture

- **App** (`app/`): Node.js 22 + Express, v0.2.  Endpoints: `/health`,
  `/ready`, `/api/message` (reads a secret from Key Vault via managed identity),
  `/api/blobs` (list/upload/download/delete text blobs in a private container),
  `/metrics`. Structured JSON logs, correlation id, graceful shutdown (SIGTERM).
- **Infra** (`infra/`): Terraform (azurerm ~4.0). Resource group, Container Apps
  environment, Container App (scale-to-zero, liveness + readiness probes), Key Vault
  (RBAC mode), Storage account + private container, user-assigned managed identity,
  Log Analytics + Application Insights, RBAC assignments, optional budget alert.
- **CI/CD** (`.github/workflows/`):
  - `pr.yml` — PR pipeline: lint, unit tests, docker build, terraform fmt/validate.
  - `ci.yml` — CI pipeline on merge to `main`: tests + build/push immutable image to GHCR.
  - `cd.yml` — CD pipeline triggered by successful CI: OIDC login, deploy new image
    revision, smoke test, print revision list for rollback.

Maps to the baseline architecture in
[Microsoft Learn — Azure Pipelines baseline architecture](https://learn.microsoft.com/en-us/azure/devops/pipelines/architectures/devops-pipelines-baseline-architecture).

## Run locally

```sh
cd app
npm ci
npm test
npm start   # http://localhost:8080/health
```

Docker:

```sh
docker build -t azulab:local app
docker run --rm -p 8080:8080 azulab:local
```

## Provision infrastructure (once)

Prerequisites: `az` logged in, `terraform` installed.

```sh
cd infra
terraform init
terraform plan -var="image=mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
terraform apply
```

Outputs include the Container App URL and the managed identity client id. The app
reads `KEY_VAULT_URL`, `STORAGE_ACCOUNT_URL` etc. from environment (set by
Terraform) and uses `DefaultAzureCredential`.

## GitHub Actions secrets/variables

OIDC (no client secret). Create an Entra app registration with a federated
credential for this repository and set repository **variables** (not secrets):

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_CONTAINER_APP`
- `AZURE_CONTAINER_APP_FQDN`

Helper: `scripts/setup-oidc.sh`.

## Rollback

See `docs/rollback.md`. One-command revision activation:

```sh
az containerapp revision list  -n "$APP" -g "$RG" -o table
az containerapp revision activate -n "$APP" -g "$RG" --revision <previous-revision>
```

## Cost

Scale-to-zero Container App, LRS storage, pay-per-token for insights. Budget alert
at 30 EUR/month via Terraform (optional, set `budget_alert_email`).
Credit window ends ~2026-11-27.
