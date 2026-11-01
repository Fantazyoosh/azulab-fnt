# 📖 Operational Runbook: Azulab Deployment & Maintenance

This runbook provides a standard operating procedure (SOP) for managing the Azulab ecosystem. It is designed to ensure that deployments are predictable and that failures are recoverable.

---

## 🛠️ 1. The Deployment Lifecycle

### Phase A: Pre-Push (Local Validation)
Before pushing code, every change must be validated locally:
- [ ] **Linting**: Ensure no syntax errors in `server.js`.
- [ ] **Terraform Plan**: Run `terraform plan` to ensure infrastructure changes are expected.
- [ ] **Docker Context**: Verify that all necessary folders (e.g., `/public`) are included in the `Dockerfile` and not ignored by `.dockerignore`.

### Phase B: Pull Request (The Gatekeeper)
Once a PR is opened, the following automated checks must pass:
- **Unit Tests**: Validation of core logic.
- **Build Check**: A trial Docker build to ensure the image is valid.
- **TFLint**: Validation of Terraform syntax.

### Phase C: Continuous Deployment (The Rollout)
Upon merge to `main`, the CD pipeline triggers:
1. **OIDC Auth**: Securely connects GitHub to Azure.
2. **Image Push**: Pushes an immutable image (tagged with Git SHA) to GHCR.
3. **Revision Update**: Azure Container Apps creates a new revision.
4. **Smoke Tests**: The pipeline pings `/health`, `/ready`, and `/api/message`. If any fail, the deployment is marked as failed.

---

## 🚨 2. Incident Response & Rollback

### How to execute a Rollback
If a deployment is "Green" but the app behaves incorrectly:
1. Go to **Azure Portal** $\rightarrow$ **Container App** $\rightarrow$ **Revisions**.
2. Select the last known stable revision.
3. Set **Traffic Split** to $100\%$ for that stable revision.
4. **Result**: Immediate recovery (Recovery Time Objective $\approx$ 10 seconds).

### Rollback Log
All rollback events are recorded in [`docs/rollback-log.md`](docs/rollback-log.md) to analyze the root cause.

---

## 🔍 3. Troubleshooting & Lessons Learned (The "War Room")

This section documents real-world issues encountered during the development of Azulab.

### 🪤 Trap 1: The "Missing Files" Error
**Symptom**: `Cannot GET /` or `404 Not Found` despite a green pipeline.
**Root Cause**: The `Dockerfile` used `COPY src ./src` but missed `COPY public ./public`. Because the build context was set to the `./app` folder, the files existed locally but never entered the image.
**Fix**: Always ensure all static asset folders are explicitly copied in the `Dockerfile`.

### ⏳ Trap 2: The "Identity Lag" (403 Forbidden)
**Symptom**: The app starts, but logs show `403 Forbidden` when accessing Key Vault.
**Root Cause**: Azure Managed Identities can take 30-60 seconds to propagate across the Azure Active Directory (Entra ID) after being created or assigned.
**Fix**: Implement a retry mechanism in the app or wait 1 minute before the first health check.

### ⚠️ Trap 3: Infrastructure Drift
**Symptom**: `terraform apply` wants to destroy and recreate a resource you manually edited in the portal.
**Root Cause**: Manual changes in the Azure Portal create "Drift". Terraform's state file no longer matches reality.
**Fix**: **NEVER** edit production resources manually. Always update the `.tf` files and apply via the pipeline.

---

## 📈 4. Health Check Definitions

| Endpoint | Type | Purpose | Failure Action |
| :--- | :--- | :--- | :--- |
| `/health` | Liveness | Is the Node.js process running? | Azure restarts the container. |
| `/ready` | Readiness | Can the app reach Key Vault & Storage? | Azure stops sending traffic to this revision. |
| `/api/message`| Smoke | Is the business logic returning a valid JSON? | Pipeline marks deployment as failed. |
