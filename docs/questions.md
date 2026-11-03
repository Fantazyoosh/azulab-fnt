# Bank pytań — autoweryfikacja przed rozmową

Przy każdym pytaniu jest plik, w którym znajdziesz dowód. Nie recytuj — pokaż plik
albo wynik komendy.

Skróty: **IaC** = infrastruktura jako kod (Terraform), **CI/CD** = automatyczne testy
i wdrożenia, **RBAC** = kontrola dostępu oparta na rolach, **OIDC** = logowanie bez
zapisanego hasła, **managed identity** = tożsamość zarządzana przez Azure,
**Workload Identity** = ta sama idea, ale dla poda w Kubernetesie.

---

## 1. Dlaczego dwa runtime'y: Container Apps **i** Kubernetes?

Gdzie: `infra/main.tf`, `infra/aks.tf`, `docs/aks.md`

Container Apps to najtańszy sposób utrzymania publicznego demo: skaluje się do zera,
płacisz za użycie, nie ma control plane'u. AKS jest droższy w utrzymaniu, ale daje
to, czego wymaga rynek: probes, rolling updates, PDB, Service endpoints, RBAC
Kubernetesa.

Oba runtime'y ciągną **ten sam obraz** z GHCR i używają **tej samej managed
identity**. Aplikacja nie wie, gdzie działa. To jest odpowiedź: nie „zamiast", tylko
„jeden artefakt, dwa środowiska wykonawcze".

## 2. Jak działa scale-to-zero i co to jest cold start?

Gdzie: `infra/main.tf` (`min_replicas = 0`)

Przy braku ruchu Container Apps wygasza repliki. Pierwszy request uruchamia nową
instancję od zera — to cold start (w tym projekcie ~50 s, bo obraz Node.js musi
wstać i pobrać sekret z Key Vault).

AKS **nie** ma scale-to-zero: `node_count = 1`, więc node działa cały czas i za
niego płacisz. To jest świadomy trade-off opisany w `docs/aks.md`.

## 3. Dlaczego user-assigned managed identity, a nie system-assigned?

Gdzie: `infra/main.tf`

User-assigned powstaje raz i można podpiąć ją do wielu zasobów. System-assigned
żyje i umiera razem z zasobem. Tutaj **ta sama** tożsamość obsługuje Container App
i pody w AKS — system-assigned nie dałoby się współdzielić.

## 4. Jak aplikacja dostaje sekret z Key Vault bez hasła w konfiguracji?

Gdzie: `app/src/server.js`, `infra/main.tf`

`DefaultAzureCredential` pobiera token z Entra ID dla tożsamości przypisanej do
zasobu. Azure sprawdza, czy ta tożsamość ma rolę `Key Vault Secrets User` **na tym
konkretnym** Key Vault. Hasła nie ma nigdzie: ani w kodzie, ani w obrazie, ani w
zmiennych środowiskowych.

## 5. Czym Workload Identity różni się od managed identity?

Gdzie: `infra/aks.tf`, `k8s/serviceaccount.yaml`, `docs/aks.md`

Mechanizm uwierzytelnienia jest ten sam (token Entra ID), ale inny jest sposób
zdobycia poświadczenia:

- Container App: platforma Azure wstrzykuje tożsamość do procesu.
- AKS: Kubernetes rzutuje **krótkotrwały token ServiceAccount** do pliku w podzie,
  a `WorkloadIdentityCredential` wymienia go na token Entra ID.

Powiązanie to **federated identity credential**: issuer = OIDC issuer klastra,
subject = `system:serviceaccount:azulab:azulab`, audience =
`api://AzureADTokenExchange`. W klastrze nie ma żadnego obiektu `Secret`.

## 6. Co udowadnia OIDC w GitHub Actions? Co to `audience`?

Gdzie: `scripts/setup-oidc.sh`, `.github/workflows/cd.yml`

GitHub wystawia krótkotrwały token podpisany przez `token.actions.githubusercontent.com`.
Azure ufa mu, bo w app registration istnieje federated credential z issuerem GitHuba
i subjectem ograniczającym **repozytorium, branch i environment**. `audience` to
`api://AzureADTokenExchange` — identyfikator zasobu, dla którego token jest ważny.
Nie ma `AZURE_CLIENT_SECRET`.

## 7. Dlaczego każdy build ma tag SHA, a nie `latest`?

Gdzie: `.github/workflows/ci.yml`, `k8s/deployment.yaml`

`latest` nie mówi, który commit działa. Tag SHA jest niezmienny: dokładnie wiadomo,
co jest wdrożone, i można wrócić do dowolnej wersji. Manifesty w `k8s/` pinnedują
konkretny SHA — nie ma „cichej" zmiany obrazu.

## 8. Jak działa rollback?

Gdzie: `docs/rollback.md`, `docs/aks.md`

- **Container Apps**: nowy deploy = nowa rewizja. Rollback = przełączenie ruchu na
  poprzednią rewizję (sekundy, bez przebudowy obrazu).
- **AKS**: `kubectl rollout undo deploy/azulab`. ReplicaSet jest niezmiennym
  snapshotem template'u, więc rollback to przestawienie wskaźnika.

## 9. Czym różni się readiness od liveness i dlaczego to nie może być to samo?

Gdzie: `k8s/deployment.yaml`, `app/src/server.js`

- `readinessProbe` → `/ready`: sprawdza Key Vault i Blob Storage. Gdy padnie,
  Kubernetes **usuwa pod z endpoints** — przestaje wysyłać mu ruch, ale go nie
  restartuje.
- `livenessProbe` → `/health`: sprawdza tylko proces. Gdyby sprawdzała zależności,
  awaria Key Vault zrestartowałaby **wszystkie** repliki i zamieniła degradację w
  totalną awarię.

To jest najważniejsze pytanie z całego projektu.

## 10. Jak zapewniony jest zero-downtime?

Gdzie: `k8s/deployment.yaml`, `docs/demo-script.md`

Cztery elementy razem:

1. `maxUnavailable: 0` + `maxSurge: 1` — nowy pod musi być Ready, zanim stary
   zostanie usunięty.
2. `readinessProbe` — „Ready" znaczy „potrafię obsłużyć request", nie „proces żyje".
3. `preStop: sleep 5` — kube-proxy przestaje kierować ruch, zanim przyjdzie SIGTERM.
4. Graceful shutdown w aplikacji — `server.close()` zamyka połączenia.

Zmierzone: **97/97 requestów 200** podczas zmiany obrazu i **87/87** podczas
`rollout restart`.

## 11. Pod, ReplicaSet, Deployment, Service — co jest czym?

Gdzie: `k8s/deployment.yaml`, `k8s/service.yaml`

- **Pod** — najmniejsza jednostka, jeden lub więcej kontenerów. Ulotny.
- **ReplicaSet** — pilnuje, żeby była wymagana liczba podów. Niezmienny snapshot
  template'u.
- **Deployment** — zarządza ReplicaSetami i rolloutem; historia rewizji.
- **Service** — stabilny adres i load balancing; tutaj typ `LoadBalancer`, który
  tworzy publiczny IP w Azure.

## 12. Dlaczego `kubenet`, a nie Azure CNI?

Gdzie: `infra/aks.tf`, `docs/aks.md`

`kubenet` nie wymaga projektowania VNetu i subnetu — AKS tworzy je sam, a pody
dostają adresy z `pod_cidr`. Dla jednodniowego labu to najmniej ruchomych części.
Produkcyjnie: Azure CNI Overlay (adresy podów z puli poza VNetem) + NetworkPolicy.

## 13. Dlaczego klaster jest w `swedencentral`, a resource group w Polsce?

Gdzie: `infra/aks.tf`, `docs/aks.md`

Subskrypcja to Azure Free Trial (`quotaId: FreeTrial_2014-09-01`). Restrykcje SKU są
per region: `polandcentral`, `westeurope`, `northeurope`, `germanywestcentral`,
`eastus`, `eastus2`, `uksouth` i `francecentral` odrzucają każdą maszynę ogólnego
przeznaczenia. `swedencentral` przyjmuje `Standard_D2as_v5`. Resource group to
kontener logiczny — nie ogranicza lokalizacji zasobów.

## 14. Co się stanie, jeśli dam `defaultAction = Deny` bez listy IP?

Gdzie: `infra/main.tf`, `variables.tf`

Zablokuję wszystko, łącznie z pipeline'em i własnymi requestami. Dlatego domyślnie
`Allow`, a blokada jest addytywna (`allowed_storage_ip_ranges`). Shared key jest
wyłączony, więc i tak trzeba mieć tożsamość w Entra ID.

## 15. Jak zablokować ruch z Rosji do Blob Storage?

Gdzie: `docs/security.md`

Storage account umie tylko allow-listę IP — nie geografię. Geografia należy do
warstwy edge (Front Door / WAF geomatch), nie do data plane.

## 16. Co zmienię dla drugiego środowiska (stage/prod)?

Gdzie: `variables.tf`, `infra/main.tf`

Osobny resource group i prefiks nazw (`project` + `environment`), inna skala,
domeny, prywatne endpointy, osobne tożsamości. Dla produkcji: 3 nody w strefach,
Standard tier control plane, private API server, Azure CNI Overlay, NetworkPolicy.

## 17. Jakie uprawnienia ograniczyłbym przed produkcją?

Gdzie: `docs/rbac-matrix.md`

- GitHub OIDC app: Contributor **na resource group**, nie na subskrypcję (już
  zrobione).
- Deploy user: brak trwałego dostępu do danych; tylko w pipeline.
- Aplikacja: `Key Vault Secrets User` i `Storage Blob Data Contributor` — już
  wąskie.
- AKS: wyłączyć local accounts i przejść na Azure RBAC for Kubernetes.

## 18. Ile to kosztuje i gdzie są alerty?

Gdzie: `infra/main.tf`, `docs/aks.md`

- Container Apps: scale-to-zero, ~0 gdy nikt nie używa.
- AKS: `Standard_D2as_v5` ~2,21 $/dzień + LB ~0,60 $/dzień + public IP ~0,12 $/dzień
  ≈ **2,93 $/dzień**.
- Control plane AKS Free = 0.
- Po demo: `kubectl delete svc azulab` i `az aks stop`.

Alert budżetowy jest szablonem (`budget_alert_email`); pusty e-mail go wyłącza.

## 19. Jak sprawdzam, że pipeline nie utknął?

Gdzie: `.github/workflows/`

- **PR checks**: lint, testy, docker build, `terraform fmt/validate`. Czerwone = brak
  merge'a.
- **CI**: testy + build + push obrazu z SHA.
- **CD**: `az containerapp update` + smoke test `/health`; brak 200 w 150 s = fail.
- **AKS**: `kubectl rollout status` z timeoutem; `kubectl get events` przy błędzie.

## 20. Czego w projekcie jeszcze nie ma (i wiem o tym)?

Gdzie: `docs/aks.md` (tabela trade-offów)

Brak HPA, ingressa z TLS, NetworkPolicy, private API server, Azure RBAC for
Kubernetes i GitOps. Każdy z tych punktów jest świadomą decyzją kosztową, nie
przeoczeniem — i ma wpisany plan produkcyjny.
