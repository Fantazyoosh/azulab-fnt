# 🚀 Azulab — Modern Cloud Native Bootstrap

> **The "Learning by Doing" Project**
> This repository is a comprehensive laboratory designed to demonstrate the bridge between simple code and **Enterprise-grade Cloud Infrastructure**. It implements the gold standards of modern DevOps: **Security-First, Infrastructure-as-Code, and Zero-Touch Deployment.**

---

## 🌟 What is Azulab?

At its core, Azulab is a simple "Broadcast Message" app. However, the *real* project is the **ecosystem around it**. 

Imagine you are building a system for a bank or a large e-commerce site. You cannot just "upload files via FTP". You need security, audit logs, and the ability to revert a mistake in seconds. **That is exactly what Azulab demonstrates.**

### 🗺️ The Big Picture (Data Flow)
`User` $\rightarrow$ `GitHub PR` $\rightarrow$ `CI/CD Pipeline (OIDC)` $\rightarrow$ `Azure Container Apps` $\rightarrow$ `Managed Identity` $\rightarrow$ `Key Vault / Blob Storage`

---

## 🛠️ The "Pro" Tech Stack (And why it matters)

| Technology | Role | Why this instead of the "easy" way? |
| :--- | :--- | :--- |
| **Terraform** | Infrastructure as Code | To avoid "clicking in the portal". Infrastructure is versioned and reproducible. |
| **OIDC** | Trust Federation | No more stored passwords/secrets in GitHub. Azure trusts GitHub's identity. |
| **Managed Identity** | Zero-Trust Auth | The app doesn't "log in" with a password; it *is* the identity. No secrets to leak. |
| **Azure Container Apps** | Serverless Compute | Scale-to-zero saves money; Revision Management allows instant rollbacks. |
| **Key Vault** | Secret Management | Secrets are encrypted and audited, not stored in `.env` files. |
| **Blob Storage** | Dynamic State | Allows updating the app's message without rebuilding or restarting the container. |

---

## 📂 Documentation Hub (Your Learning Path)

If you are new to DevOps, follow this order to understand the project:

1. **[The "How-To" Guide (`docs/runbook.md`)](docs/runbook.md)** 
   $\rightarrow$ *Learn the operational lifecycle: from code change to smoke test.*
2. **[The Security Blueprint (`docs/security.md`)](docs/security.md)** 
   $\rightarrow$ *Understand why "Zero-Trust" is the industry standard and how OIDC works.*
3. **[The Architect's Q&A (`docs/questions.md`)](docs/questions.md)** 
   $\rightarrow$ *The most important part for interviews. Learn how to justify technical decisions.*
4. **[The Incident Log (`docs/rollback-log.md`)](docs/rollback-log.md)** 
   $\rightarrow$ *See how real-world failures are handled and recovered.*

---

## 🚀 Quick Start

### 💻 Local Run (The "Developer" Experience)
```bash
cd app
npm install
npm start
```
Visit `http://localhost:8080` to see the UI.

### ☁️ Cloud Deploy (The "DevOps" Experience)
1. Create a branch $\rightarrow$ `git checkout -b feat/my-feature`
2. Push changes $\rightarrow$ `git push origin feat/my-feature`
3. Open a **Pull Request** $\rightarrow$ Watch the pipeline validate your code.
4. **Merge** $\rightarrow$ Watch Azure deploy the new version automatically.

---

## 🎓 What I learned building this
- **Infrastructure Drift**: How to keep the portal and code in sync.
- **Principle of Least Privilege**: Granting only the exact permissions needed (RBAC).
- **Immutable Infrastructure**: Why we use SHA tags instead of `latest` for Docker images.
- **Observability**: Using structured JSON logs to debug production issues.
