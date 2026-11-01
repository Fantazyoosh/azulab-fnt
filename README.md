# Azulab — Modern Cloud Native Bootstrap

> **Disclaimer:** This is a hands-on personal lab project designed to test and demonstrate modern Enterprise DevOps & Cloud Native patterns (IaC, Zero-Trust Security, GitOps/CI/CD, and Observability). It is not intended for heavy production workloads.

---

## 🎯 Overview

Azulab is a lightweight Node.js web application coupled with a complete, production-grade cloud infrastructure on Microsoft Azure. It serves as a blueprint for how to deliver software safely, securely, and automatically.

### Key Highlights
- **Infrastructure as Code (IaC):** 100% managed via Terraform.
- **Zero-Trust Security:** No hardcoded secrets. Authentication via **OpenID Connect (OIDC)** in GitHub Actions and authorization via **Azure Managed Identity (RBAC)**.
- **Automated CI/CD:** Three-stage pipeline (PR validation, immutable image building with SHA tags, automated deployment and smoke tests).
- **Interactive Cloud State:** Hybrid configuration leveraging **Azure Key Vault** for static secrets and **Azure Blob Storage** for dynamic broadcast messages with real-time web UI.
- **High Availability & Resilience:** Zero-downtime deployments and rapid Rollback capabilities using Azure Container Apps revisions.

---

## 🏗️ Architecture & Tech Stack

- **Cloud Provider:** Microsoft Azure (`Poland Central`)
- **Compute:** Azure Container Apps (ACA) with Scale-to-Zero and Revision Management.
- **Storage:** Azure Blob Storage (Document/Message state) & Azure Key Vault (System secrets).
- **Observability:** Azure Log Analytics & Application Insights.
- **Automation:** GitHub Actions (OIDC integration, no stored credentials).
- **Application:** Node.js 22 (Express.js, Pino structured logs, Metrics) with a minimalist Editorial Design frontend.

---

## 📂 Documentation & Deep Dives

To fully understand the design decisions, deployment procedures, and security model, please refer to the following documents inside the `docs/` folder:

1. **[Deployment Runbook (`docs/runbook.md`)](docs/runbook.md)**
   - Step-by-step guide on what is checked before a push, during PR, CI, CD, and how to execute a Rollback Drill.
2. **[Security Architecture (`docs/security.md`)](docs/security.md)**
   - Detailed explanation of OIDC federation, Managed Identities, Least Privilege RBAC, and data flow.
3. **[Interview & Architecture Q&A (`docs/questions.md`)](docs/questions.md)**
   - Bank of 15 practical architectural questions mapped directly to files in the repository in plain language.
4. **[Rollback Log (`docs/rollback-log.md`)](docs/rollback-log.md)**
   - Incident response record and time-to-recovery metrics.

---

## 🚀 Quick Start / Local Development

### Prerequisites
- Node.js 22+
- Docker
- Azure CLI & Terraform (if provisioning infra)

### 1. Run Locally
```bash
cd app
npm install
npm start
```
The app will run on `http://localhost:8080`.

### 2. Run Tests
```bash
cd app
npm test
```

---

## 🔄 CI/CD & Deployment Flow

1. **Pull Request (`pr.yml`):** Runs linter, unit tests, Docker build verification, and Terraform validation.
2. **Continuous Integration (`ci.yml`):** Builds the immutable container image tagged with the Git commit SHA and pushes it to GitHub Container Registry (GHCR).
3. **Continuous Deployment (`cd.yml`):** Authenticates via OIDC (no secrets), updates the Azure Container App, and executes automated **Smoke Tests** (`/health`, `/ready`, `/api/message`).
