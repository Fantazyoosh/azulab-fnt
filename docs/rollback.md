# Rollback

The CD pipeline deploys an **immutable image tag** (full commit SHA) as a new
Container Apps revision and keeps previous revisions. Rollback does not rebuild
anything — it reactivates a previous revision or redeploys a previous tag.

## Option A — activate a prior revision (fastest)

```sh
az containerapp revision list \
  --name "$AZURE_CONTAINER_APP" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  -o table

az containerapp revision activate \
  --name "$AZURE_CONTAINER_APP" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --revision <previous-revision-name>
```

## Option B — redeploy a previous image tag

```sh
az containerapp update \
  --name "$AZURE_CONTAINER_APP" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --image "ghcr.io/<owner>/<repo>:<previous-sha>"
```

## Verify

```sh
curl -fsS "https://$AZURE_CONTAINER_APP_FQDN/health"
az containerapp revision list -n "$AZURE_CONTAINER_APP" -g "$AZURE_RESOURCE_GROUP" \
  --query "[?properties.active].name" -o tsv
```

Document every rollback in `docs/rollback-log.md` (date, reason, from/to revision,
duration, what broke, prevention). This is the difference between "I can click
redeploy" and "I have an incident process".
