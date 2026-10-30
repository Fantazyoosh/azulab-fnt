#!/usr/bin/env bash
# Creates an Entra app registration + service principal with OIDC federated
# credentials for a GitHub repository and prints the values to store as GitHub
# *variables* (not secrets). az CLI and gh CLI must already be authenticated.
set -euo pipefail

: "${REPO:?set REPO=owner/repo}"
APP_NAME="${APP_NAME:-azureflow-github-oidc}"
ENV_NAME="${ENV_NAME:-production}"

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

echo "subscription: $SUBSCRIPTION_ID"
echo "tenant:       $TENANT_ID"

APP_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
az ad sp create --id "$APP_ID" >/dev/null
echo "client_id:    $APP_ID"

# RBAC: Contributor on the whole subscription (narrow to RG after first apply if desired).
az role assignment create \
  --assignee "$APP_ID" \
  --role Contributor \
  --scope "/subscriptions/$SUBSCRIPTION_ID" >/dev/null

create_cred() {
  local name="$1" subject="$2"
  local body
  body=$(printf '{"name":"%s","issuer":"https://token.actions.githubusercontent.com","subject":"%s","description":"GitHub Actions OIDC","audiences":["api://AzureADTokenExchange"]}' "$name" "$subject")
  az ad app federated-credential create --id "$APP_ID" --parameters "$body" >/dev/null
}

create_cred "github-main"     "repo:$REPO:ref:refs/heads/main"
create_cred "github-production" "repo:$REPO:environment:$ENV_NAME"

echo
echo "Add these as GitHub repository VARIABLES:"
echo "  AZURE_CLIENT_ID=$APP_ID"
echo "  AZURE_TENANT_ID=$TENANT_ID"
echo "  AZURE_SUBSCRIPTION_ID=$SUBSCRIPTION_ID"
echo "  AZURE_RESOURCE_GROUP=rg-azureflow-dev-polandcentral   # adjust if you changed names"
echo "  AZURE_CONTAINER_APP=ca-azureflow-dev"
echo "  AZURE_CONTAINER_APP_FQDN=<from terraform output container_app_url, host only>"
