#!/usr/bin/env bash
# Creates the Entra ID security groups that hold Azure RBAC assignments.
#
# Why groups: onboarding and offboarding become a membership change, not a set of
# role assignments scattered across resources. The pipeline and the humans never
# get a direct role on a resource.
#
# Idempotent: existing groups and assignments are reused.
#
# Usage:
#   ./scripts/setup-entra-groups.sh
#
# Requires: az CLI logged in, Global Administrator or Groups Administrator,
# and Owner/User Access Administrator on the target scopes.
set -euo pipefail

RG="${RG:-rg-azulab-dev-polandcentral}"
KV="${KV:-kv-azulab-dev-6mvarl}"
SP_APP_ID="${SP_APP_ID:-112c715b-6e39-47d8-bad5-1a5065751990}"

SUB=$(az account show --query id -o tsv)
USER_OID=$(az ad signed-in-user show --query id -o tsv)
SP_OID=$(az ad sp show --id "$SP_APP_ID" --query id -o tsv)
RG_SCOPE="/subscriptions/$SUB/resourceGroups/$RG"
KV_SCOPE=$(az keyvault show -n "$KV" --query id -o tsv)

ensure_group() {
  local name="$1"
  local id
  id=$(az ad group list --query "[?displayName=='$name'].id | [0]" -o tsv)
  if [ -z "$id" ]; then
    id=$(az ad group create \
      --display-name "$name" \
      --mail-nickname "$name" \
      --description "Azulab lab: $name" \
      --query id -o tsv)
    echo "created group  $name ($id)" >&2
  else
    echo "exists  group  $name ($id)" >&2
  fi
  printf '%s' "$id"
}

ensure_member() {
  local group_id="$1" member_id="$2" label="$3"
  if az ad group member check --group "$group_id" --member-id "$member_id" --query value -o tsv | grep -qi true; then
    echo "exists  member $label" >&2
  else
    az ad group member add --group "$group_id" --member-id "$member_id" >/dev/null
    echo "added   member $label" >&2
  fi
}

ensure_assignment() {
  local group_id="$1" role="$2" scope="$3"
  if az role assignment list --assignee "$group_id" --role "$role" --scope "$scope" --query "[0].id" -o tsv | grep -q .; then
    echo "exists  role   $role -> group" >&2
    return 0
  fi

  # A freshly created group takes a moment to replicate to the RBAC data plane.
  # Without this retry the first run fails with PrincipalNotFound.
  local attempt
  for attempt in 1 2 3 4 5; do
    if az role assignment create \
      --assignee-object-id "$group_id" \
      --assignee-principal-type Group \
      --role "$role" \
      --scope "$scope" >/dev/null 2>&1; then
      echo "created role   $role -> group" >&2
      return 0
    fi
    echo "retry   role   $role (group not replicated yet, attempt $attempt)" >&2
    sleep 20
  done

  echo "FAILED  role   $role -> group" >&2
  return 1
}

ADMINS=$(ensure_group "azulab-platform-admins")
DEPLOYERS=$(ensure_group "azulab-deployers")
READERS=$(ensure_group "azulab-readers")

ensure_member "$ADMINS" "$USER_OID" "user -> azulab-platform-admins"
ensure_member "$DEPLOYERS" "$SP_OID" "pipeline SP -> azulab-deployers"

ensure_assignment "$DEPLOYERS" "Contributor" "$RG_SCOPE"
ensure_assignment "$ADMINS" "Key Vault Administrator" "$KV_SCOPE"
ensure_assignment "$READERS" "Reader" "$RG_SCOPE"

cat <<EOF

Groups and assignments are in place. Direct assignments are intentionally NOT
removed by this script — verify group-based access first, then cut over:

  az role assignment delete --assignee $SP_OID --role Contributor --scope "$RG_SCOPE"
  az role assignment delete --assignee $USER_OID --role "Key Vault Administrator" --scope "$KV_SCOPE"

Group-based RBAC can take up to 10 minutes to propagate.
EOF
