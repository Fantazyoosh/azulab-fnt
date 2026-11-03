# Rollback

The CD pipeline deploys an **immutable image tag** (full commit SHA). Rollback
does not rebuild anything — it moves a pointer to a previous revision (Container
Apps) or a previous ReplicaSet (AKS), or redeploys a previous tag.

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

## Option C — AKS (Kubernetes)

```sh
kubectl -n azulab rollout history deploy/azulab
kubectl -n azulab rollout undo deploy/azulab
kubectl -n azulab rollout status deploy/azulab --timeout=240s
```

A ReplicaSet is an immutable snapshot of the pod template, so `undo` is a pointer
move. There is no rebuild, and the previous image is already on the node.

## Verify

```sh
curl -fsS "https://$AZURE_CONTAINER_APP_FQDN/health"
az containerapp revision list -n "$AZURE_CONTAINER_APP" -g "$AZURE_RESOURCE_GROUP" \
  --query "[?properties.active].name" -o tsv
```

Document every rollback in `docs/rollback-log.md` (date, reason, from/to revision,
duration, what broke, prevention). This is the difference between "I can click
redeploy" and "I have an incident process".
