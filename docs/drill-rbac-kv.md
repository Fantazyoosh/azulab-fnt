# Drill — RBAC, bezpieczeństwo, Key Vault

Karta do mówienia na głos, nie do czytania. Odpowiedz w 60 sekund, potem sprawdź.
Jeśli utkniesz — wróć do wskazanego pliku, nie do całego dokumentu.

> Materiał źródłowy: `docs/references.md` (oficjalne linki Microsoft Learn)
> i `docs/deep-dive-keyvault-blob.md` (dwa komponenty, warstwa po warstwie).

---

## A. RBAC

**A1. Czym RBAC różni się od uwierzytelniania?**
Uwierzytelnianie mówi *kim jesteś* (Entra ID, token, managed identity).
Autoryzacja mówi *co możesz zrobić* (RBAC). Token bez roli nic nie daje.

**A2. Cztery elementy role assignment?**
Security principal (kto), role definition (co), scope (gdzie), role assignment
(połączenie). Zawsze wymieniaj wszystkie cztery.

**A3. Jak działa dziedziczenie scope?**
Management group → subscription → resource group → resource. Uprawnienie nadane
wyżej dziedziczy w dół. Dlatego `Contributor` na subskrypcji jest groźny.

**A4. Control plane vs data plane — przykład z projektu.**
`Contributor` pozwala zmienić konfigurację sejfu, ale **nie** czyta sekretu.
Do danych potrzebne są role data-plane: `Key Vault Secrets User`,
`Storage Blob Data Contributor`. To jest najczęstsze nieporozumienie.

**A5. Kto może tworzyć role assignments?**
Nie `Contributor` — potrzebujesz `Owner` albo `User Access Administrator`
(`Microsoft.Authorization/roleAssignments/write`). Pipeline, który nadaje role,
musi to mieć; pipeline, który tylko wdraża — nie.

**A6. Aplikacja dostaje 403 z Key Vault. Co sprawdzasz w kolejności?**
1. Czy tożsamość jest przypisana i czy `AZURE_CLIENT_ID` wskazuje właściwą?
2. Czy rola jest na **tym** sejfie, nie na innym?
3. Czy sejf używa RBAC czy access policies? (mieszanie modeli to pułapka)
4. Czy nie ma propagation delay? (RBAC do ~10 min, token MI ~60 s)
5. Czy firewall / private endpoint nie blokuje?
6. Czy nazwa sekretu i tenant są poprawne?
7. Co mówią logi diagnostyczne — jaki principal dostał `Forbidden`?

**Dowód w repo:** `docs/rbac-matrix.md`, `infra/main.tf` (role assignments).

---

## B. Bezpieczeństwo

**B1. Jak GitHub loguje się do Azure bez sekretu?**
OIDC. GitHub wystawia krótkotrwały token; Azure weryfikuje issuer
(`token.actions.githubusercontent.com`), subject (repo + branch/environment)
i audience (`api://AzureADTokenExchange`). Nie ma `AZURE_CLIENT_SECRET`.

**B2. Managed identity vs Workload Identity?**
Ten sam mechanizm tokenu Entra ID, inny sposób jego zdobycia. Container Apps
wstrzykuje tożsamość platformowo. W AKS Kubernetes rzutuje token ServiceAccount
do pliku, a `WorkloadIdentityCredential` wymienia go na token Azure. Powiązanie
to federated credential z subjectem `system:serviceaccount:azulab:azulab`.

**B3. Dlaczego wyłączyłeś shared key w Storage?**
Klucz konta to alternatywna, nieaudytowana ścieżka dostępu z pełnymi prawami.
Po wyłączeniu nie istnieje sekret, który może wyciec; zostaje Entra ID + RBAC.
Konsekwencja: provider Terraform musi używać `storage_use_azuread = true`,
a CLI — `--auth-mode login`.

**B4. Dlaczego allow-list „tylko moje IP” nie działa dla PaaS?**
Bo ruch wychodzi z dynamicznego egress IP platformy, nie z Twojego domu.
Wpisanie domowego IP daje 403 aplikacji. Poprawnie: private endpoint + VNet
albo stały egress przez NAT gateway.

**B5. Co widzi atakujący, który przejmie poda?**
Krótkotrwały token audience-bound, ważny do wygaśnięcia, bez uprawnień do API
Kubernetesa. Może czytać sekret i bloby w zakresie swojej roli — i nic więcej.
Nie ma klucza storage, nie ma client secret, nie ma `Secret` obiektu w klastrze.

**B6. Co logujesz i po co?**
Key Vault (all logs), Blob (write/delete), AKS (`kube-audit-admin`,
`cluster-autoscaler`) → Log Analytics. Bez tego nie odpowiesz „kto usunął
sekret” ani „kto zmienił deployment”.

**Dowód w repo:** `docs/security.md`, `docs/secret-lifecycle.md`,
`infra/provider.tf`, `infra/main.tf` (diagnostics).

---

## C. Key Vault — zaawansowany

**C1. Secret vs key vs certificate?**
Secret: dowolny string, **brak natywnej rotacji** (automatyzujesz przez Event
Grid + Function). Key: klucz kryptograficzny, ma natywną rotation policy.
Certificate: X.509 + polityka lifetime actions.

**C2. Siedem etapów cyklu życia sekretu?**
Create → use → rotate → expire → disable → delete → purge. Każda wersja ma
własne `id`, `enabled`, `nbf`, `exp`; nowa wersja nie usuwa starej.

**C3. Soft delete vs purge protection?**
Soft delete: obiekt zostaje 7–90 dni i można go odzyskać (włączone zawsze).
Purge protection: nie można usunąć trwale przed końcem retencji, nawet Ownerem.
Jest **nieodwracalne** i rezerwuje nazwę sejfu po usunięciu.

**C4. Jak sprawdzisz, czy sekret jest nadal używany?**
Diagnostic settings → Log Analytics, zapytanie o `SecretGet`/`SecretList`
w czasie, pogrupowane po tożsamości. Brak odczytów od 90 dni = kandydat do
wyłączenia.

**C5. Sekret wyciekł — pierwsze trzy działania?**
Disable (natychmiast), rotate (nowa wersja), audit (kto i skąd czytał).
Dalej: revoke uprawnień, notify jeśli GDPR, post-mortem.

**C6. Gdzie trzymasz wartość sekretu w Terraformie?**
Nigdzie. Terraform tworzy sejf i RBAC, a wartość ustawia CLI/pipeline
(`az keyvault secret set`). Wartość w `.tf` ląduje w state i w historii Git.
W tym projekcie resource jest usunięty ze state przez
`removed { lifecycle { destroy = false } }`.

**C7. Jak zrotować sekret bez długiego przestoju?**
Nowa wersja w Key Vault → restart/rolling update aplikacji (nasza aplikacja
czyta raz przy starcie i cache'uje). Docelowo Event Grid `SecretNearExpiry`
→ Function/Logic App → nowa wersja + restart.

**Dowód w repo:** `docs/secret-lifecycle.md`, `infra/main.tf` (`removed`),
`app/src/server.js` (`loadSecretWithRetry`).

---

## D. Trzy odpowiedzi po 30 sekund

**RBAC:**
> „RBAC to principal + role definition + scope. Nadaję na najniższym scope,
> rozdzielam tożsamość wdrożeniową od runtime, a aplikacji daję managed identity
> i role data-plane, nie Contributor. Do tworzenia role assignments potrzebny
> jest User Access Administrator, bo Contributor tego nie obejmuje.”

**Bezpieczeństwo:**
> „Nie ma sekretów w Git ani w klastrze: GitHub używa OIDC, aplikacja używa
> managed identity lub Workload Identity. Storage ma wyłączony shared key,
> Key Vault ma purge protection, a dostęp jest ograniczony do jednego resource
> group i konkretnych zasobów. Wszystko jest logowane do Log Analytics.”

**Key Vault:**
> „Sekret ma cykl życia: create, use, rotate, expire, disable, delete, purge.
> Rotację automatyzuję przez Event Grid + Function, a klucze i certyfikaty mają
> natywną politykę. Włączam purge protection; w Terraformie zarządzam sejfem
> i RBAC, nie wartością sekretu.”

---

## E. Gdzie sprawdzić dowód

| Temat | Plik | Komenda |
| --- | --- | --- |
| RBAC | `docs/rbac-matrix.md` | `az role assignment list --assignee <id> --all -o table` |
| OIDC | `scripts/setup-oidc.sh` | `gh variable list` |
| Shared key | `infra/main.tf` | `az storage account show -n stazulabdev6mvarl -g rg-azulab-dev-polandcentral --query allowSharedKeyAccess` |
| Purge protection | `infra/main.tf` | `az keyvault show -n kv-azulab-dev-6mvarl --query properties.enablePurgeProtection` |
| Workload Identity | `k8s/serviceaccount.yaml`, `infra/aks.tf` | `kubectl -n azulab exec deploy/azulab -- env \| grep AZURE_` |
| Brak sekretów | `k8s/` | `kubectl -n azulab get secrets` |
| Logi | `infra/main.tf` | `az monitor diagnostic-settings list --resource <id>` |
| Cykl życia | `docs/secret-lifecycle.md` | `az keyvault secret list-versions --vault-name kv-azulab-dev-6mvarl --name app-message` |
