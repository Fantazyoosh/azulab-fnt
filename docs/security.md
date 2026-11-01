# 🛡️ Security Architecture: Zero-Trust Model

This document explains the security choices made in Azulab. The goal was to achieve a **Zero-Trust Architecture**, meaning we never trust a secret based on where it is stored, but rather based on the **Identity** of the requester.

---

## 🔑 The Core Philosophy: No More Secrets

In traditional apps, you often see `.env` files with passwords. In Enterprise DevOps, this is a critical vulnerability. Azulab solves this using three pillars:

### 1. OIDC (OpenID Connect) — The Trust Bridge
**The Problem:** How does GitHub Actions tell Azure "I am the official pipeline for this project" without using a long-lived Client Secret?

**The Solution:** **OIDC Federation**.
- GitHub issues a temporary JWT token.
- Azure validates this token against the trusted GitHub provider.
- Azure grants a short-lived access token for the deployment.

**Why?** If a hacker steals your GitHub Actions logs, there is no permanent password to steal.

### 2. Managed Identity — The "Passport"
**The Problem:** Once the app is running in Azure, how does it authenticate with Key Vault or Storage?

**The Solution:** **User-Assigned Managed Identity**.
- The Container App is assigned a unique Identity (similar to a service account).
- Azure internally handles the rotation of certificates.
- The app uses `DefaultAzureCredential` from the SDK, which automatically finds this identity.

**Why?** No credentials ever exist in the code, the Docker image, or the environment variables.

### 3. RBAC (Role-Based Access Control) — Least Privilege
**The Problem:** Should the app have "Admin" access to everything in the subscription?

**The Solution:** **Least Privilege Roles**.
- `Key Vault Secrets User`: Can read secrets, but cannot delete the Vault.
- `Storage Blob Data Contributor`: Can read/write blobs, but cannot change network rules.

**Why?** If the application is compromised, the attacker is limited to only these specific actions.

---

## 📊 Security Summary Table

| Vulnerability | Legacy Approach | Azulab Approach | Result |
| :--- | :--- | :--- | :--- |
| **Credential Leak** | Store secret in GitHub Secrets | **OIDC Federation** | ❌ No secrets to leak |
| **Identity Theft** | App uses a username/password | **Managed Identity** | ❌ No password to steal |
| **Over-privilege** | Subscription Contributor | **RBAC Roles** | ❌ Limited attack surface |
| **Secret Exposure** | Secrets in `.env` or config | **Azure Key Vault** | ❌ Encrypted at rest |

---

## 🛠️ Verification Flow
To verify that this is working, look at:
- `infra/main.tf`: See the `azurerm_user_assigned_identity` and `azurerm_role_assignment` resources.
- `app/src/server.js`: See the use of `@azure/identity` and `DefaultAzureCredential`.
