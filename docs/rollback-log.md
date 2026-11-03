# Rollback log

| Date | Trigger | From | To | Duration | Root cause | Prevention |
|---|---|---|---|---|---|---|
| 2026-11-03 | AKS rehearsal drill (not an incident) | revision 4 (`rollout restart`) | revision 3 (`rollout undo`) | ~45 s | Deliberate: verify that `kubectl rollout undo` returns to the previous ReplicaSet without a rebuild | Keep `revisionHistoryLimit: 5`; the previous image is still cached on the node |

## What the drill proved

- `kubectl rollout undo` moved the Deployment back to the previous ReplicaSet;
  the pods were replaced with a rolling update (`maxUnavailable: 0`).
- No image pull was needed: the previous tag was already on the node.
- During the preceding `rollout restart`, 90/90 health requests returned 200 —
  no 5xx, no dropped connections.

## How to repeat

```bash
kubectl -n azulab rollout history deploy/azulab
kubectl -n azulab rollout undo deploy/azulab
kubectl -n azulab rollout status deploy/azulab --timeout=240s
```

Record every real rollback here: date, trigger, from/to revision, duration,
root cause, prevention. A rollback without a root cause is just a restart.
