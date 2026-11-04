# Prezentacja — runbook na dzień rozmowy

Jedna strona. Wszystko, co trzeba zrobić przed rozmową i w jej trakcie.
Aplikacja to **Azulab Drop**: upload → seal → podpisany link. UI jest planszą
prezentacji; każda zakładka dowodzi jednej rzeczy o platformie.

---

## 1. Adresy

| Runtime | URL | Dostęp |
| --- | --- | --- |
| **AKS** | **http://74.158.77.185/** | publiczny, bez logowania |
| **Container Apps** | https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io | HTTPS + login Entra; `/s/*` bez sesji |

Oba runtime'y na tym samym tagu — aktualny SHA pokaże `/version` na AKS oraz
`az containerapp show` dla ACA.

> IP AKS jest przypisane do `Service`. Jeśli Service zostanie usunięty i odtworzony,
> adres się zmieni. Zawsze pobieraj go komendą, nie z notatek:
> ```bash
> kubectl -n azulab get svc azulab -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
> ```

---

## 2. Piętnaście minut przed rozmową

```bash
# 1. Klaster włączony? (po az aks stop start trwa 3-5 min)
az aks show -g rg-azulab-dev-polandcentral -n aks-azulab-dev \
  --query powerState.code -o tsv

# jeśli Stopped:
az aks start -g rg-azulab-dev-polandcentral -n aks-azulab-dev

# 2. Kontekst
az aks get-credentials -g rg-azulab-dev-polandcentral -n aks-azulab-dev --overwrite-existing
kubectl config current-context          # aks-azulab-dev

# 3. Service istnieje? Jeśli nie — odtwórz TYLKO jego:
kubectl -n azulab get svc azulab || kubectl apply -f k8s/service.yaml

# 4. Adres i weryfikacja
IP=$(kubectl -n azulab get svc azulab -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "http://$IP/"
curl -s "http://$IP/health"
curl -s "http://$IP/ready"
curl -s "http://$IP/version"
curl -s "http://$IP/api/config" | jq '{store,keyVault,keyVersion,keyFingerprint}'

# 5. HPA i pody
kubectl -n azulab get hpa azulab
kubectl -n azulab get pods

# 6. Rozgrzej Container Apps (min_replicas = 0)
ACA=https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io
curl -s -o /dev/null -w "%{http_code}\n" "$ACA/health"
curl -s -o /dev/null -w "%{http_code}\n" "$ACA/"
```

### Checklist

- [ ] `kubectl get nodes` → 1 node `Ready`
- [ ] `kubectl -n azulab get pods` → **2/2 Running**
- [ ] HPA: `MINPODS 2`, `MAXPODS 6`, `TARGETS cpu: …/60%`
- [ ] `/ready` → `{"status":"ready","keyVault":"ok","storage":"ok","signingKey":"…"}`
- [ ] `/api/config` → `store: azure`, `keyVault: keyvault`
- [ ] ACA `/health` 200, `/` → **401**
- [ ] link `/s/<id>` z AKS otwiera się też na ACA (bez logowania)
- [ ] `terraform plan` → `No changes`
- [ ] otwarte karty: AKS UI, ACA, GitHub Actions,
      `docs/evidence/verification-2026-11-04.txt`

---

## 2a. Interfejs — osiem zakładek

Otwórz UI na adresie AKS i zostań na nim. Karty są celowo jednokartkowe —
rozwiązujesz je werbalnie, nie czytasz z ekranu.

| Zakładka | Co pokazuje | Kiedy użyć |
| --- | --- | --- |
| **01 Drop** | upload, seal, podpisany link, katalog dropów | otwarcie rozmowy — produkt naprawdę działa |
| **02 Blob** | obiekty, wersje, soft-delete, tier, lifecycle | „gdzie to leży i dlaczego bez klucza" |
| **03 RBAC** | claims + trzy probe'y: 200 / 200 / 403 | „tożsamość, nie klucze; Owner ≠ data plane" |
| **04 Key Vault** | wersja i fingerprint klucza, rotate/revoke | „sekret nigdy nie trafia do UI" |
| **05 Scaling** | rozkład podów, HPA 2 → 6, CPU 60% | „autoscaling na prawdziwym CPU" |
| **06 Cost** | rachunek, lewary, lifecycle | „koszt jest decyzją architektoniczną" |
| **07 Availability** | readiness, crash/drain, PDB | „readiness drenuje, liveness restartuje" |
| **08 Delivery** | SHA, obraz, pod, AKS vs ACA | „jeden obraz, dwa runtime'y" |

---

## 3. Kolejność pokazywania (12 min)

| # | Zakładka | Co kliknąć / pokazać | Co powiedzieć |
| --- | --- | --- | --- |
| 1 | **Drop** | wgraj `docs/azulab-interview-pack.md`; poczekaj na seal; **Share**; otwórz link | „To jest produkt: plik, seal i link. Reszta rozdziałów to Azure pod nim." |
| 2 | **Drop** | **Verify** przy wpisie; pokaż `Seal record` | „SHA-256 + PBKDF2; seal to realna praca CPU, nie sleep." |
| 3 | **Blob** | **Refresh stats**; **Write 20**; **Soft-delete round trip** | „Kontener prywatny, shared key wyłączony, managed identity. Soft delete jest prawdziwy." |
| 4 | **Blob** | sekcja **Protection** i **Lifecycle** | „Cool po 30 dniach, delete po 90 — jedyny rosnący zasób ma granicę." |
| 5 | **RBAC** | **Run all three probes** | „200 na sekret, 200 na blob, 403 na account keys. Runtime nie może wyeksportować klucza." |
| 6 | **RBAC** | tabela **Assignments** | „Grupy trzymają przypisania; pipeline ma Contributor na RG, nie na subskrypcję." |
| 7 | **Key Vault** | **Refresh key state**; pokaż wersję i fingerprint | „Wartości nie ma w UI. Wersja jest w URL-u, więc rotacja nie łamie starych linków." |
| 8 | **Key Vault** | sekcja **Operations** | „Wyłączenie wersji rewokuje jej linki; każda replika sprawdza wersję najwyżej raz na 60 s." |
| 9 | **Scaling** | **Observe 20 requests**; **Run 12s of seals** | „HPA 2–6, cel 60% requestu. PBKDF2 idzie na threadpool, więc event loop odpowiada." |
| 10 | **Scaling** | w terminalu `kubectl get hpa -w` (opcjonalnie burn 60 s) | „Przy dłuższym obciążeniu HPA dochodzi do 6; node 2 vCPU jest sufitem." |
| 11 | **Cost** | sekcja **The bill** i **Levers** | „2,93 $/dzień; dominuje node i LoadBalancer; ACA jest 0 przy bezczynności." |
| 12 | **Availability** | **Drain this pod (60 s)**; patrz na timeline i endpointy | „Readiness usuwa pod z ruchu, nie restartuje procesu. PDB chroni dobrowolne przerwy." |
| 13 | **Availability** | sekcja **The reasoning** | „Liveness dotyka tylko procesu; zależności są w readiness. Jedna awaria nie restartuje wszystkich podów." |
| 14 | **Delivery** | SHA, obraz, pod; tabela AKS vs ACA | „Ten sam commit, ten sam obraz, dwa runtime'y. ACA ma Easy Auth, AKS jest publiczny." |
| 15 | **Delivery** | link do Actions / sekcja **Pipeline** | „PR waliduje, main buduje obraz, CD wdraża na oba runtime'y i robi smoke test." |

Pełne komendy i tekst: **[`docs/demo-script.md`](demo-script.md)**.

### Opcjonalny dowód HPA 2 → 6

```bash
POD=$(kubectl -n azulab get pods -o jsonpath='{.items[0].metadata.name}')
kubectl -n azulab exec "$POD" -- timeout 120 sh -c 'yes > /dev/null' &
kubectl -n azulab get hpa azulab -w
```

Po ~90 s `REPLICAS` dojdzie do 6, a po zakończeniu i oknie stabilizacji wróci do 2.
Nie rób tego, jeśli czasu jest mało — wersja z UI (12 s) pokazuje 2 → 3.

---

## 4. Cztery zdania, które muszą paść

1. **„Jeden obraz, dwa runtime'y — Kubernetes do orkiestracji, Container Apps do logowania."**
2. **„Owner to control plane, nie data plane: mogę utworzyć storage, ale nie odczytać bloba."**
3. **„Wersja klucza jest w podpisanym URL-u: rotacja nie łamie linków, a wyłączenie wersji je rewokuje w maksymalnie 60 s."**
4. **„Readiness usuwa pod z ruchu, liveness restartuje proces — dlatego liveness nie sprawdza zależności."**

---

## 5. Plan B

| Problem | Reakcja |
| --- | --- |
| AKS nie wstaje | Pokaż `docs/evidence/verification-2026-11-04.txt` + screenshot; przejdź do RBAC/Key Vault na ACA |
| `kubectl` łączy się z localhost:8080 | `az aks get-credentials … --overwrite-existing` |
| Brak IP po odtworzeniu Service | `kubectl -n azulab get svc azulab -w` (2–4 min) |
| ACA cold start | Powtórz `curl` po 30–60 s |
| Login zwraca błąd konta | Zaloguj się `maciej.waszkiewicz@me.com`, nie gmailowym |
| Drop zwraca 503 | `/api/config` → czy `store` to `azure`; sprawdź `/ready` |
| Link 403 | Sprawdź, czy wersja klucza nie została wyłączona; porównaj `v=` z `/api/config` |
| Pipeline czerwony | Nie naprawiaj na żywo; pokaż ostatni zielony run i wyjaśnij krok AKS |

**Nie rób `terraform apply` na żywo.** Pokaż `terraform plan` → `No changes`.

---

## 6. Po rozmowie

```bash
kubectl -n azulab delete service azulab   # zwalnia LoadBalancer i IP
az aks stop -g rg-azulab-dev-polandcentral -n aks-azulab-dev
```

Konsekwencje zatrzymania klastra:

- node przestaje być bilowany (~2,21 $/dzień mniej),
- Deployment i pody zostają w etcd i wrócą po `az aks start`,
- **Service i publiczne IP przepadają** — odtworzenie to `kubectl apply -f k8s/service.yaml`,
- **każdy merge kodu do `main` wywali CD** na kroku `Deploy to AKS`, dopóki klaster jest zatrzymany. Merge dokumentacji jest bezpieczny (`paths-ignore`).
