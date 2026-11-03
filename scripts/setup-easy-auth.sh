#!/usr/bin/env bash
# Enables Container Apps built-in authentication ("Easy Auth") with Entra ID.
#
# Minimum viable setup:
#   * a single-tenant app registration with the Container Apps callback URI
#   * the client secret stored as a Container App secret (never in Git/Terraform)
#   * the Microsoft identity provider configured against that secret
#   * /health and /ready excluded so probes and the CD smoke test keep working
#
# Re-running rotates the client secret and reapplies the configuration.
#
# Usage:
#   ./scripts/setup-easy-auth.sh
set -euo pipefail

RG="${RG:-rg-azulab-dev-polandcentral}"
APP="${APP:-ca-azulab-dev}"
WEB_APP_NAME="${WEB_APP_NAME:-azulab-web}"
SECRET_NAME="${SECRET_NAME:-aad-client-secret}"

FQDN=$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)
TENANT=$(az account show --query tenantId -o tsv)
REDIRECT="https://$FQDN/.auth/login/aad/callback"

APP_ID=$(az ad app list --display-name "$WEB_APP_NAME" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create \
    --display-name "$WEB_APP_NAME" \
    --sign-in-audience AzureADMyOrg \
    --web-redirect-uris "$REDIRECT" \
    --query appId -o tsv)
  echo "created app registration $WEB_APP_NAME ($APP_ID)" >&2
else
  echo "app registration $WEB_APP_NAME exists ($APP_ID)" >&2
fi

# The service principal and the ID-token setting are required by Easy Auth.
az ad sp show --id "$APP_ID" >/dev/null 2>&1 || az ad sp create --id "$APP_ID" >/dev/null
az ad app update --id "$APP_ID" --enable-id-token-issuance true >/dev/null

# The secret lives in the Container App secret store, not in the repository.
SECRET=$(az ad app credential reset \
  --id "$APP_ID" --append --display-name easy-auth --years 1 \
  --query password -o tsv)
az containerapp secret set -g "$RG" -n "$APP" --secrets "$SECRET_NAME=$SECRET" >/dev/null

# Provider first, then the global policy (action + excluded paths).
az containerapp auth microsoft update -g "$RG" -n "$APP" \
  --client-id "$APP_ID" \
  --client-secret-name "$SECRET_NAME" \
  --tenant-id "$TENANT" \
  --yes >/dev/null

az containerapp auth update -g "$RG" -n "$APP" \
  --enabled true \
  --action RedirectToLoginPage \
  --excluded-paths "/health,/ready" \
  --require-https true >/dev/null

# Secret changes only apply to a new or restarted revision.
REV=$(az containerapp show -g "$RG" -n "$APP" --query properties.latestRevisionName -o tsv)
az containerapp revision restart -g "$RG" -n "$APP" --revision "$REV" >/dev/null

cat <<EOF
Easy Auth enabled.

  login        https://$FQDN/.auth/login/aad
  excluded     /health, /ready
  redirect     $REDIRECT
  app id       $APP_ID
  secret name  $SECRET_NAME (Container App secret, rotates in 1 year)

Disable it again with:
  az containerapp auth update -g $RG -n $APP --enabled false
EOF
