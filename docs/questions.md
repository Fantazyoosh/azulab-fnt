# Bank pytań w prostym języku (15)

Służy do autoweryfikacji i przygotowania do prezentacji projektu. Przy każdym pytaniu jest ścieżka do pliku, gdzie znajdziesz dowód. Nie recytuj — pokaż plik.

Skróty rozszerzone na start:  
**IaC** = infrastruktura jako kod (Terraform), **CI/CD** = automatyczne testy i wdrożenia, **RBAC** = kontrola dostępu oparta o role, **OIDC** = logowanie bez zapisanego hasła, **Container App** = usługa uruchamiająca kontener, **Key Vault** = sejf na sekrety, **Blob** = chmura na pliki, **managed identity** = legitymacja aplikacji.

1. **Dlaczego Azure Container Apps zamiast App Service albo Kubernetes?**  
   Gdzie: `infra/main.tf`, README  
   Odpowiedź: najprościej włączone, płacono za użycie, skalują się same. App Service to droższy, statyczny compute. Kubernetes to za dużo na lab i dla rozmowy niepotrzebne.

2. **Jak działa scale-to-zero (skalowanie do zera) i co to znaczy cold start?**  
   Gdzie: `infra/main.tf` (`min_replicas = 0`)  
   Odpowiedź: przy braku ruchu Azure wygasza instancje. Pierwszy request uruchamia nową od nowa (kilka–kilkanaście sekund, zależnie od obrazu i runtime).

3. **Dlaczego user-assigned managed identity, a nie system-assigned?**  
   Gdzie: `infra/main.tf`  
   Odpowiedź: user-assigned powstaje raz i możesz podpiąć do wielu zasobów. System-assigned znika razem z zasobem. Na labie to jeden Container App, ale wzorzec jest „reusable".

4. **Jak aplikacja dostaje sekret z Key Vault bez żadnego hasła w configu?**  
   Gdzie: `app/src/server.js`, `infra/main.tf`  
   Odpowiedź: DefaultAzureCredential używa tożsamości Container App. Azure sprawdza, czy rola `Key Vault Secrets User` jest nadana dla tej tożsamości na tym Key Vault.

5. **Co dokładnie robi `DefaultAzureCredential` i w jakiej kolejności?**  
   Gdzie: `docs/security.md`  
   Odpowiedź: env vars, managed identity, Azure CLI, inne. W Azure wygrywa managed identity. W naszej appce bez `AZURE_CLIENT_ID` (user-assigned) managed identity nie działa — stąd ten konfig.

6. **Co udowadnia OIDC (federated credential) w GitHub Actions? Co to `audience`?**  
   Gdzie: `scripts/setup-oidc.sh`  
   Odpowiedź: pozwala wdrożyć bez `client secret` (`client secret = null`). Audience to `api://AzureADTokenExchange` — identyfikator docelowego zasobu Access Tokena.

7. **Dlaczego w pipeline nie trzymam `AZURE_CLIENT_SECRET`?**  
   Gdzie: `docs/security.md`  
   Odpowiedź: OIDC. Token jest krótkol adultem (rabok, tokeny 1h), związany z repo/branch/environment. Nawet przy kradzieży repo bez tokenu ktoś nic nie zrobi.

8. **Czym różni się PR od CI od CD? Dlaczego testy integracyjne tylko po merge?**  
   Gdzie: baseline article + `.github/workflows/`  
   Odpowiedź: PR: szybkie testy przed merge. CI: build + test po merge + publikacja obrazu. CD: deploy + smoke test. Testy integracyjne są cięższe i nie muszą blokować każdego PR.

9. **Jak działa rollback i dlaczego taniej niż ponowny deploy?**  
   Gdzie: `docs/rollback.md`  
   Odpowiedź: Container Apps trzyma rewizje. Rollback = aktywuj poprzednią rewizję. Bez ponownego budowania i pushowania obrazu.

10. **Dlaczego każdy build ma nowy tag (SHA commitu), a nie `latest`?**  
    Gdzie: `ci.yml`, `cd.yml`  
    Odpowiedź: `latest` jest nieczytelne (który commit to jest?). Tag SHA = wersja niezmienna; dokładnie wiadomo, co jest wdrożone.

11. **Jak blokować ruch z Rosji do Blob Storage i dlaczego storage account tego nie umie?**  
    Gdzie: `docs/security.md`  
    Odpowiedź: reguły storage account to allow-list IP, nie geografia. Geografia należy do warstwy edge (Front Door / WAF geomatch), nie data plane.

12. **Co się stanie, jeśli dam `defaultAction = Deny` na storage bez listy IP?**  
    Gdzie: `variables.tf`, `main.tf`  
    Odpowiedź: zablokuję wszystko — także pipeline i własne requesty. Zatem domyślnie `Allow`, a blokada jest addytywna.

13. **Co zmienię dla drugiego środowiska (stage / prod)?**  
    Gdzie: `variables.tf`, `main.tf`  
    Odpowiedź: prefiks nazw, resource group, skala, domeny, uprawnienia; najprościej przez `project`/`environment` i osobne RG.

14. **Jakie trzy uprawnienia ograniczyłbym przed „produkcją"?**  
    Gdzie: `infra/main.tf` (RBAC)  
    Odpowiedź: `Key Vault Secrets User` zamiast Administrator; `Storage Blob Data Contributor` na folderze zamiast całego konta; deploy user `Key Vault Officer` (albo brak ręcznego dostępu).

15. **Skąd wiem ile to kosztuje i gdzie alerty?**  
    Gdzie: `variables.tf` z `budget_alert_email`  
    Odpowiedź: Cost analysis w portalu + `az consumption`. Alert 30 EUR/mies. jest szablonem, nie automatycznym (pusty mail = wyłączony).

## Pytanie: jak sprawdzam, żeby CI/CD nie utykał?

- **PR checks**: lint, testy, docker build, terraform fmt/validate. Jeśli który poślinie się → nie merged.
- **CI**: testy ponownie, build, push obrazu z SHA. Zły tag? Sprawdź metadata action.
- **CD**: smoke test `/health` i `/ready`. 503 → rollback, nie czekaj.
- **Readiness**: kolejne rewizja musi mieć health 200 w < 60 s; jeśli 503 ciągnie się > 2 probe, traktuj jako fail.
- **Logi**: każdy request ma correlation id i JSON — szukasz po `requestId`.
- **Smoke zapisany w pipeline**: jeśli Local smoke test nie odpali, pipeline się czerwony.

To jest bank 15 pytań w prostym języku, z dowodami w plikach.  
Pomóż: wiem gdzie szukać, a nie recytować.  
EOF
echo "questions.md written"
