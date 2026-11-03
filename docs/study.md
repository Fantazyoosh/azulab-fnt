# Jak się uczyć — plan na pięć sesji

Cel: po każdej sesji umiesz **powiedzieć** dany temat w 60 sekund i **pokazać**
dowód komendą. Nie czytaj wszystkiego po kolei — jedno pytanie, jeden plik,
jedna komenda.

Zasada: **read → prove → say**. Najpierw przeczytaj sekcję, potem uruchom
komendę, na końcu powiedz odpowiedź na głos bez zaglądania.

---

## Sesja 1 — RBAC (45 min)

**Czytaj**
- [`docs/rbac-matrix.md`](rbac-matrix.md) — grupy, wyjątki, blast radius.
- [`docs/references.md`](references.md) — sekcja RBAC + „Entra ID groups".
- [`docs/drill-rbac-kv.md`](drill-rbac-kv.md) — pytania **A1–A7**.

**Udowodnij**
```bash
SP=dce65f63-06be-435b-acc0-b0f6f2d1d751
az role assignment list --assignee $SP --all --query "length(@)" -o tsv   # 0
az ad group member check --group azulab-deployers --member-id $SP         # true
az role assignment list --assignee <group-id> --all -o table              # Contributor na RG
```

**Powiedz na głos**
- Czym RBAC różni się od uwierzytelniania?
- Cztery elementy role assignment.
- Control plane vs data plane — dlaczego `Owner` nie czyta blobów.
- Dlaczego role nadajesz grupom.

**Musisz umieć:** „Pipeline ma zero bezpośrednich ról; dziedziczy Contributor
z grupy `azulab-deployers`. Ja dziedziczę dostęp do sejfu z
`azulab-platform-admins`."

---

## Sesja 2 — Key Vault (45 min)

**Czytaj**
- [`docs/secret-lifecycle.md`](secret-lifecycle.md) — create → purge, rotacja, co widzi atakujący.
- [`docs/deep-dive-keyvault-blob.md`](deep-dive-keyvault-blob.md) — **Część 1**.
- [`docs/references.md`](references.md) — sekcja Key Vault.

**Udowodnij**
```bash
az keyvault show -n kv-azulab-dev-6mvarl \
  --query "{purge:properties.enablePurgeProtection, softDelete:properties.softDeleteRetentionInDays}"
az keyvault secret list-versions --vault-name kv-azulab-dev-6mvarl --name app-message -o table
```

Audyt (Log Analytics):
```kusto
AzureDiagnostics
| where ResourceType == 'VAULTS'
| where OperationName in ('SecretGet','SecretList')
| project TimeGenerated, OperationName, ResultType, CallerIPAddress, identity_claim_oid_g
| order by TimeGenerated desc
| take 20
```

**Powiedz na głos**
- Siedem etapów cyklu życia sekretu.
- Soft delete vs purge protection.
- Jak sprawdzić, czy sekret jest używany.
- Gdzie trzymasz wartość sekretu w Terraformie (i dlaczego nie).

**Musisz umieć:** „Sekret ma cykl życia; purge protection blokuje trwałe
usunięcie; logi pokazują OID tożsamości, która go czytała."

---

## Sesja 3 — Blob Storage (45 min)

**Czytaj**
- [`docs/deep-dive-keyvault-blob.md`](deep-dive-keyvault-blob.md) — **Część 2**.
- [`docs/security.md`](security.md) — sekcja Storage hardening.
- [`docs/references.md`](references.md) — sekcja Blob Storage.

**Udowodnij**
```bash
# Owner nie czyta danych — 403
az storage blob list --account-name stazulabdev6mvarl --container-name demo --auth-mode login

# klucz się wylistuje, ale nie uwierzytelni
KEY=$(az storage account keys list -n stazulabdev6mvarl -g rg-azulab-dev-polandcentral --query "[0].value" -o tsv)
az storage blob list --account-name stazulabdev6mvarl --container-name demo --account-key "$KEY"
# KeyBasedAuthenticationNotPermitted

# wersjonowanie i soft delete
az storage account blob-service-properties show --account-name stazulabdev6mvarl
```

**Powiedz na głos**
- Shared key vs Entra ID + RBAC.
- Dlaczego „allow only my IP" nie działa dla PaaS.
- Soft delete vs versioning.
- Co to private endpoint i czego wymaga.

**Musisz umieć:** „Wyłączenie shared key nie usuwa klucza — odbiera mu
możliwość uwierzytelnienia. Owner to control plane i nie czyta blobów."

---

## Sesja 4 — Kubernetes / AKS (45 min)

**Czytaj**
- [`docs/aks.md`](aks.md) — architektura, Workload Identity, probes, koszt.
- [`k8s/deployment.yaml`](../k8s/deployment.yaml) — komentarze przy każdym polu.
- [`docs/demo-script.md`](demo-script.md) — kroki 1–8.

**Udowodnij**
```bash
kubectl get nodes
kubectl -n azulab get deploy,pods,svc
kubectl -n azulab get deploy azulab -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl -n azulab exec deploy/azulab -- env | grep AZURE_
```

**Powiedz na głos**
- Pod / ReplicaSet / Deployment / Service.
- Readiness vs liveness — dlaczego liveness nie sprawdza Key Vault.
- `maxUnavailable: 0` + `preStop` + SIGTERM = zero-downtime.
- Workload Identity: annotation → token → federated credential → token Entra.

**Musisz umieć:** „Readiness usuwa pod z endpoints; liveness restartuje proces.
Dlatego awaria Key Vault drenuje ruch, a nie restartuje wszystkich replik."

---

## Sesja 5 — Całość na głos (45 min)

1. Przejdź [`docs/demo-script.md`](demo-script.md) od początku do końca.
2. Odpowiedz na 21 pytań z [`docs/questions.md`](questions.md).
3. Powiedz trzy odpowiedzi po 30 sekund z [`docs/drill-rbac-kv.md`](drill-rbac-kv.md) — sekcja D.
4. Otwórz [`docs/presentation.md`](presentation.md) i przejdź checklistę.

---

## Checklista „umiem bez notatek"

- [ ] RBAC: principal + rola + scope + assignment
- [ ] Control plane vs data plane (przykład: Owner nie czyta blobów)
- [ ] Dlaczego grupy, a nie użytkownicy
- [ ] Key Vault: create → use → rotate → expire → disable → delete → purge
- [ ] Soft delete vs purge protection
- [ ] Audyt: `SecretGet` + `identity_claim_oid_g`
- [ ] Dlaczego sekret nie jest w Terraformie
- [ ] Shared key off — co to naprawdę znaczy
- [ ] Dlaczego allow-list IP nie działa dla PaaS
- [ ] Private endpoint vs firewall
- [ ] Pod / ReplicaSet / Deployment / Service
- [ ] Readiness vs liveness
- [ ] Zero-downtime: `maxUnavailable: 0`, `preStop`, SIGTERM
- [ ] Workload Identity — cały łańcuch
- [ ] Dlaczego `swedencentral`, a nie `polandcentral`
- [ ] `kubenet` — trade-off
- [ ] Jeden obraz, dwa runtime'y (i dlaczego Easy Auth ma jeden sekret)
- [ ] Co bym zmienił dla produkcji (3 rzeczy)

---

## Trzy odpowiedzi po 30 sekund

**RBAC:**
> „Principal + rola + scope. Nadaję na najniższym scope, pipeline nie ma
> bezpośrednich ról — dziedziczy z grupy. Aplikacja ma tylko role data-plane."

**Key Vault:**
> „Sekret ma cykl życia. Purge protection blokuje trwałe usunięcie, a logi
> pokazują, która tożsamość go czytała. W Terraformie zarządzam sejfem, nie
> wartością."

**Bezpieczeństwo całości:**
> „OIDC w CI, managed identity i Workload Identity w runtime, shared key
> wyłączony, storage i vault z diagnostyką. Jeden długotrwały sekret: Easy Auth,
> świadomie zaakceptowany."

---

## Mapa plików

| Chcę zrozumieć | Plik |
| --- | --- |
| RBAC i grupy | `docs/rbac-matrix.md`, `docs/drill-rbac-kv.md` (A) |
| Key Vault | `docs/secret-lifecycle.md`, `docs/deep-dive-keyvault-blob.md` (1) |
| Blob Storage | `docs/deep-dive-keyvault-blob.md` (2) |
| Kubernetes / AKS | `docs/aks.md`, `k8s/` |
| Entra login | `docs/entra-login.md` |
| Decyzje i trade-offy | `docs/decisions.md` |
| Pytania na rozmowę | `docs/questions.md` |
| Linki Microsoft Learn | `docs/references.md` |
| Demo krok po kroku | `docs/demo-script.md` |
| Dzień rozmowy | `docs/presentation.md` |
| Dowody weryfikacji | `docs/evidence/verification-2026-11-03.txt` |
