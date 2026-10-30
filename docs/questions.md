# Interview question bank (starter)

Mapped to files so each answer has a path, not a memory.

1. Why Container Apps instead of App Service or AKS? (`infra/main.tf`, README)
2. How does scale-to-zero actually happen, and what is the cold start cost? (`main.tf`)
3. Why two managed identities (user-assigned vs system-assigned) — and which did you use? (`main.tf`)
4. How does the app get the Key Vault secret with no secret in config? (`app/src/server.js`, `main.tf`)
5. What exactly does `DefaultAzureCredential` try, in order? (docs/security.md)
6. What does OIDC federated credential prove, and what is the audience? (`scripts/setup-oidc.sh`)
7. Why no `AZURE_CLIENT_SECRET` in GitHub, and what prevents token replay? (docs/security.md)
8. PR vs CI vs CD: what runs where, and why integration tests only after merge?
   (baseline article, `.github/workflows/`)
9. How does rollback work, and why is it cheaper than redeploy? (`docs/rollback.md`)
10. Why immutable image tags (SHA) instead of `latest`? (`ci.yml`, `cd.yml`)
11. How would you geo-block Russia from the blob, and why not in storage rules?
    (`docs/security.md`)
12. What breaks if the storage account network default action becomes Deny with no
    IP list? (`variables.tf`, `main.tf`)
13. What would change for a second environment (stage/prod)? (variables, tags)
14. Which three least-privilege changes would you make before calling this prod?
15. How do you know the cost, and what alerts exist? (variables `budget_alert_email`)
