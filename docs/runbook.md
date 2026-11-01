# 📖 Operational Runbook: Azulab Deployment & Maintenance

This runbook provides a standard operating procedure (SOP) for managing the Azulab ecosystem. It is designed to ensure that deployments are predictable and that failures are recoverable.

---

## 🛠️ 1. The Deployment Lifecycle

### The Deployment Layer (CI/CD Flow)
The project uses a high-automation deployment layer to move code from Git to Azure.

**Step 1: Continuous Integration (CI)**
- **Validation**: Every push triggers unit tests in `/app/test`.
- **Immutable Builds**: A Docker image is built and tagged with the specific **Git Commit SHA**. We avoid using the `latest` tag to ensure we know exactly which version is running.
- **Registry**: Images are stored in GHCR (GitHub Container Registry).

**Step 2: Continuous Deployment (CD)**
- **Zero-Trust Auth**: The pipeline connects to Azure using **OIDC**, eliminating the need for stored client secrets.
- **Revision Management**: Azure Container Apps creates a new **Revision** for every deploy. This allows us to keep the old version running while the new one starts.

**Step 3: Verification (The Safe-Switch)**
- **Smoke Testing**: The pipeline pings `/health` and `/ready` endpoints.
- **Traffic Shifting**: Traffic is only shifted to the new revision if smoke tests pass. This ensures **Zero-Downtime Deployments**.

---

## 🏗️ 2. Infrastructure as Code (Terraform)

Azulab uses Terraform to ensure the infrastructure is versioned, reproducible, and documented.

### The Terraform Lifecycle
1. **Definition**: Infrastructure is defined in `.tf` files.
2. **Plan (`terraform plan`)**: Before any change, we generate a plan to see exactly what will be created, modified, or destroyed. This prevents accidental deletions.
3. **Apply (`terraform apply`)**: The approved plan is executed, and Azure resources are updated to match the code.

### State Management & Drift
- **Remote State**: The `terraform.tfstate` file (the "map" of the infrastructure) is stored remotely. This allows the GitHub Actions pipeline to know the current state of the cloud without needing local files.
- **Infrastructure Drift**: If a resource is changed manually in the Azure Portal, it creates "Drift". Terraform detects this during the next `plan` and offers to revert the manual change back to the coded state.

---

## 🚨 3. Incident Response & Rollback

### How to execute a Rollback
If a deployment is "Green" but the app behaves incorrectly:
1. Go to **Azure Portal** $\rightarrow$ **Container App** $\rightarrow$ **Revisions**.
2. Select the last known stable revision.
3. Set **Traffic Split** to $100\%$ for that stable revision.
4. **Result**: Immediate recovery (Recovery Time Objective $\approx$ 10 seconds).

### Rollback Log
All rollback events are recorded in [`docs/rollback-log.md`](docs/rollback-log.md) to analyze the root cause.

---

## 🔍 4. Troubleshooting & Lessons Learned (The "War Room")

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

## 📈 5. Health Check Definitions

| Endpoint | Type | Purpose | Failure Action |
| :--- | :--- | :--- | :--- |
| `/health` | Liveness | Is the Node.js process running? | Azure restarts the container. |
| `/ready` | Readiness | Can the app reach Key Vault & Storage? | Azure stops sending traffic to this revision. |
| `/api/message`| Smoke | Is the business logic returning a valid JSON? | Pipeline marks deployment as failed. |

---

## ⚙️ 6. Pipeline Behavior: The "Trigger" Lesson

### Why does a documentation change trigger a full Azure deploy?
You may notice that updating a `.md` file in `/docs` still triggers the full CI/CD pipeline. This is because the GitHub Actions trigger is currently set to the **repository level** (`on: push`), not the **folder level**.

**Current Flow:**
`Any Change in Repo` $\rightarrow$ `Trigger CD` $\rightarrow$ `Build Image` $\rightarrow$ `Deploy to Azure`.

### How to optimize this (Path Filtering)
In larger production environments, building a Docker image for a typo fix in the README is a waste of compute resources. This is solved using `paths-ignore`.

**Example Configuration:**
```yaml
on:
  push:
    paths-ignore:
      - 'docs/**'
      - 'README.md'
```

**The Trade-off:**
- **Current State**: Every push is a "smoke test" for the pipeline. We know the deployment process works 100% of the time.
- **Optimized State**: Faster feedback loop and lower compute costs, but the pipeline is tested less frequently.
