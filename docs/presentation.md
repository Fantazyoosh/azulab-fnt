# Prezentacja — runbook na dzień rozmowy

Jedna strona. Wszystko, co trzeba zrobić przed rozmową i w jej trakcie.

---

## 1. Adresy

| Runtime | URL | Dostęp |
| --- | --- | --- |
| **AKS** | **http://74.158.77.185/** | publiczny, bez logowania |
| **Container Apps** | https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io | HTTPS + login Entra |

Oba runtime'y na tym samym tagu: `dbed82244a6c6457793a74fad70904128a930765`.

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

# 5. Rozgrzej Container Apps (min_replicas = 0)
curl -s -o /dev/null -w "%{http_code}\n" \
  https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io/health
```

### Checklist

- [ ] `kubectl get nodes` → 1 node `Ready`
- [ ] `kubectl -n azulab get pods` → **2/2 Running**
- [ ] `/version` na AKS pokazuje **ten sam tag** co Container Apps
- [ ] `/ready` → `{"status":"ready","keyVault":"ok","storage":"ok"}`
- [ ] ACA `/health` 200, `/` → **401**
- [ ] `terraform plan` → `No changes`
- [ ] otwarte karty: AKS UI, ACA, GitHub Actions, `docs/evidence/verification-2026-11-03.txt`

---

## 3. Kolejność pokazywania (12 min)

| # | Co | Komenda | Co powiedzieć |
| --- | --- | --- | --- |
| 1 | Klaster | `kubectl get nodes`, `get pods` | „Jeden node, Free tier, 2 repliki" |
| 2 | Artefakt | obraz AKS vs ACA | „Ten sam tag, dwa runtime'y" |
| 3 | Zero-downtime | pętla `curl` + `rollout restart` | „maxUnavailable: 0, 100% 200" |
| 4 | Readiness | `fail-readiness`, endpoints | „pod wypada z ruchu, nie restartuje się" |
| 5 | RBAC | 0 ról pipeline'u, grupa | „członkostwo, nie przypisanie" |
| 6 | Key Vault | audyt KQL | „kto, skąd, kiedy czytał sekret" |
| 7 | Blob | Owner 403, klucz odrzucony | „control plane ≠ data plane" |
| 8 | Entra login | ACA → login | „jeden sekret, świadomie zaakceptowany" |
| 9 | CI/CD | zielony run | „merge → obraz → oba runtime'y" |
| 10 | Trade-offy | single node, kubenet, brak HPA | „świadome decyzje kosztowe" |

Pełne komendy i tekst: **[`docs/demo-script.md`](demo-script.md)**.

---

## 4. Trzy zdania, które muszą paść

1. **„Jeden obraz, dwa runtime'y — Kubernetes do orkiestracji, Container Apps do logowania."**
2. **„Readiness usuwa pod z ruchu, liveness restartuje proces. Dlatego liveness nie sprawdza zależności."**
3. **„Nie ma sekretów poza jednym: Easy Auth wymaga confidential client. Wszystko inne to OIDC, managed identity i Workload Identity."**

---

## 5. Plan B

| Problem | Reakcja |
| --- | --- |
| AKS nie wstaje | Pokaż `docs/evidence/verification-2026-11-03.txt` + screenshot; przejdź do security i Entra |
| `kubectl` łączy się z localhost:8080 | `az aks get-credentials … --overwrite-existing` |
| Brak IP po odtworzeniu Service | `kubectl -n azulab get svc azulab -w` (2–4 min) |
| ACA cold start | Powtórz `curl` po 30–60 s |
| Login zwraca błąd konta | Zaloguj się `maciej.waszkiewicz@me.com`, nie gmailowym |
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
