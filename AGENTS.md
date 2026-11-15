# AGENTS.md — Azulab

## What this is
File-sharing app on Azure: blob storage, key vault, container apps. Two parts and a
deployment: `infra/` (Terraform), `app/` (Node), `k8s/` (manifests).

`agentlab/` is a **second repo** for Azure lab docs — do not add its files here.

## Commands
| Task | Command |
|---|---|
| Init providers | `terraform -chdir=infra init` |
| Plan | `terraform -chdir=infra plan` |
| App install | `cd app && npm ci` |
| App tests | `cd app && npm test` |
| Lint | `cd app && npm run lint` |
| Deploy | `kubectl apply -k k8s` |

## Do not commit
`.terraform/`, `node_modules/`, real `terraform.tfvars` (only the `.example`),
state files, `*.bak`.

## Rules
- Money first: `budget_amount` and alerts exist for a reason. A plan that adds a paid
  resource needs the monthly cost in the reply.
- `terraform plan` before `apply`, always. Paste the plan summary.
- This project costs real money on a student budget. When in doubt, destroy.
