# Azulab Drop — przewodnik dla początkującego

Ten dokument jest po to, żebyś **rozumiał projekt i umiał go opowiedzieć**, nawet
jeśli nie jesteś DevOps engineerem. Nie ucz się wszystkiego na pamięć. Przeczytaj
go raz spokojnie, potem wróć do sekcji „Scenariusz 12 minut” i powiedz go na głos.

Aplikacja na żywo: **http://74.158.77.185/** (adres AKS może się zmienić — pobierz
go komendą z sekcji Preflight). Wersję i pod pokaże `/version` oraz nagłówek UI.

Komendy do każdego kroku: [`docs/demo-script.md`](demo-script.md). Ten przewodnik
tłumaczy **dlaczego**, tamten pokazuje **jak**.

---

## 1. Projekt w jednym akapicie

Azulab Drop to mała aplikacja do udostępniania plików. Użytkownik wgrywa plik,
aplikacja zapisuje go w prywatnym Blob Storage, liczy **seal** (celowo wolny
odcisk pliku) i wydaje **podpisany link**, który wygasa.

Najważniejsze jest to, co pod spodem: **ten sam obraz kontenera** działa na dwóch
runtime’ach — **AKS** (Kubernetes) i **Azure Container Apps**. AKS pokazuje
Kubernetes: pody, probes, PDB, HPA. ACA pokazuje managed ingress, Easy Auth
i scale-to-zero. Oba runtime’y używają **managed identity** (na AKS przez
Workload Identity) do Key Vault i Blob, więc w podzie nie ma sekretów.

Link jest podpisany **HMAC-iem** kluczem z Key Vault. Wersja klucza jest w URL,
więc rotacja nie łamie starych linków, a wyłączenie wersji rewokuje je w ciągu
maksymalnie 60 sekund.

Koszt to około **2,93 $/dzień**: głównie jeden node i LoadBalancer. Świadome
ograniczenia: jeden node, brak cluster autoscalera i brak ingressu z TLS.

---

## 2. Słownik — wszystkie pojęcia po ludzku

### Kubernetes i AKS

| Pojęcie | Co to jest | W tym projekcie |
| --- | --- | --- |
| **AKS** | Managed Kubernetes w Azure. | Klaster, na którym działa aplikacja. To **nie jest strona** — aplikację otwierasz w przeglądarce, a klaster oglądasz przez `kubectl`. |
| **kubectl** | Narzędzie w terminalu do rozmowy z Kubernetes API. | `kubectl get pods`, `kubectl logs`, `kubectl rollout status`. |
| **node** | Maszyna (VM), na której Kubernetes uruchamia pody. | Jeden node `Standard_D2as_v5`: 2 vCPU, 8 GiB. To on jest sufitem. |
| **pod** | Najmniejsza jednostka uruchomieniowa: kontener (lub kilka) z wspólną siecią. | Dwa pody aplikacji. HPA zmienia liczbę podów, nie node’ów. |
| **Deployment** | Deklaracja „chcę N podów z tym obrazem”. | `azulab`; tworzy ReplicaSet i pody; rollout wymienia wersje. |
| **ReplicaSet** | Pilnuje, żeby liczba podów zgadzała się z żądaniem. | Tworzony przez Deployment. |
| **Service** | Stabilny adres i load balancing do podów. | `azulab`; type `LoadBalancer`. |
| **LoadBalancer** | Typ Service, który prosi Azure o publiczny LB i IP. | `http://74.158.77.185/`; koszt ~0,60 $/dzień + IP ~0,12. |
| **Ingress** | Warstwa L7: routing po hostie/ścieżce i TLS. | **Nie mamy** na AKS. ACA ma managed ingress z TLS. |
| **runtime** | Środowisko, w którym działa proces. | AKS albo ACA. „Runtime identity” = tożsamość procesu. |

### Skalowanie i niezawodność

| Pojęcie | Co to jest | W tym projekcie |
| --- | --- | --- |
| **HPA** | HorizontalPodAutoscaler: kontroler, który zmienia liczbę **podów** na podstawie metryki (CPU). | Min 2, max 6, target 60% requestu. Nie dodaje node’ów. |
| **cluster autoscaler** | Dodaje/usuwa **node’y**, gdy pody nie mają gdzie się zmieścić. | **Nie mamy**. To produkcyjny next step. |
| **rollout** | Wymiana podów na nową wersję. | `maxSurge: 1`, `maxUnavailable: 0`; nowy pod musi być Ready, zanim stary zniknie. |
| **readiness** | „Czy pod może przyjmować ruch?” | `/ready` sprawdza klucz i Storage. Jak padnie, pod wypada z endpointów, ale **nie jest restartowany**. |
| **liveness** | „Czy proces żyje?” | `/health` sprawdza tylko proces. Jak padnie, kubelet restartuje **kontener w tym samym podzie**. |
| **PDB** | PodDisruptionBudget: limit dobrowolnych przerw. | `minAvailable: 1`; chroni drain, **nie** awarię node’a. |
| **smoke test** | Minimalny test po wdrożeniu. | CD sprawdza `/health` i `/ready` na obu runtime’ach. |

### Dostawa i artefakt

| Pojęcie | Co to jest | W tym projekcie |
| --- | --- | --- |
| **commit SHA** | Unikalny hash commita. | Tag obrazu; `/version` pokazuje ten sam SHA na AKS i ACA. |
| **CI** | Continuous Integration: testy, build, push obrazu. | PR waliduje; main buduje i pushuje `ghcr.io/...:<sha>`. |
| **CD** | Continuous Deployment: wdrożenie artefaktu. | Ten sam tag na ACA i AKS; HPA przed rollem; smoke test. |
| **GHCR** | GitHub Container Registry. | Publiczny rejestr obrazu; brak ACR. |
| **obraz / tag** | Paczka aplikacji i jej etykieta. | `ghcr.io/fantazyoosh/azulab-fnt:a415e19...`; nigdy `latest`. |

### Tożsamość i bezpieczeństwo

| Pojęcie | Co to jest | W tym projekcie |
| --- | --- | --- |
| **managed identity** | Tożsamość Azure bez hasła; Azure wydaje token. | `id-azulab-dev-app`: Key Vault Secrets User + Storage Blob Data Contributor. |
| **Workload Identity** | Sposób, w jaki pod używa managed identity bez sekretu. | AKS rzutuje token service account; Entra wymienia go przez federated credential. |
| **OIDC** | Zaufanie między GitHub Actions a Azure. | Brak `AZURE_CLIENT_SECRET`; GitHub wydaje krótkotrwały token. |
| **Easy Auth** | Wbudowana autoryzacja Container Apps. | Entra ID; root i `/api/*` wymagają sesji; `/health`, `/ready`, `/s/*` wyłączone. |
| **RBAC** | Role, zakresy i przypisania. | Pipeline: Contributor na RG; runtime: wąskie role data-plane; człowiek: Owner. |
| **control plane** | Warstwa zarządzania zasobami (ARM). | Tworzenie storage, przypisywanie ról. Owner/Contributor. |
| **data plane** | Warstwa danych w usłudze. | Czytanie blobów, sekretów. Wymaga `Storage Blob Data Reader/Contributor` lub `Key Vault Secrets User`. |

### Kryptografia produktu

| Pojęcie | Co to jest | W tym projekcie |
| --- | --- | --- |
| **SHA-256** | Szybki, jednokierunkowy hash; 256 bitów = 64 znaki hex. | `digest = SHA-256(file)`; wykrywa zmianę pliku. |
| **PBKDF2** | Celowo wolna funkcja wyprowadzania klucza. | 600 000 iteracji HMAC-SHA256 na digestcie i soli; daje `seal`. |
| **digest** | Wynik SHA-256. | Szybki odcisk pliku; pole `digest` w `seal.json`. |
| **seal** | Wynik PBKDF2. | Wolny odcisk pliku; integralność + koszt CPU. **Nie** szyfruje i **nie** jest podpisem. |
| **fingerprint** | Krótki SHA-256 **wartości klucza**. | Pokazany w UI, żeby widzieć zmianę klucza bez ujawniania sekretu. Nie ma go w linku. |
| **HMAC** | Hash z kluczem symetrycznym. | `sig = HMAC-SHA256(key, id.exp.v)`; podpis linku. |
| **key version** | Niemutowalna wersja sekretu w Key Vault. | `v` w URL; stare linki niosą swoją wersję. |
| **rotation** | Dodanie nowej wersji klucza. | Nowe linki przechodzą na nową wersję w ciągu 5 min; stare działają. |
| **revocation** | Wyłączenie konkretnej wersji. | Stare linki z tą wersją dostają 403 w ciągu maksymalnie 60 s. |

### Kody HTTP

| Kod | Znaczenie | W tym projekcie |
| --- | --- | --- |
| **200** | OK. | Plik wraca, probe zdrowy. |
| **401** | Brak uwierzytelnienia. | ACA root bez sesji Entra. |
| **403** | Odmowa dostępu. | Zły podpis linku, wyłączona wersja klucza, brak roli data-plane. |
| **404** | Nie znaleziono. | Nieznany drop. |
| **410** | Zasób już nie istnieje. | Link wygasł. |
| **503** | Usługa chwilowo niedostępna. | Brak gotowych endpointów, readiness fail, Storage down. |

---

## 3. Jak działa produkt — Drop krok po kroku

### Upload

- Plik leci jako **raw bytes**, nie multipart.
- Nazwa pliku jedzie w nagłówku `x-filename`, ale **nie trafia do ścieżki**.
- Blob nazywa się zawsze `file`; dzięki temu `../` nie może uciec z kontenera.
- Limit: 5 MB. Id dropa jest losowe.

### Seal

1. `digest = SHA-256(file bytes)`.
2. `seal = PBKDF2-SHA256(digest, salt=id, iterations=600000, keylen=32)`.
3. Wynik trafia do `seal.json`.

To **nie jest szyfrowanie**. Plik w Blob jest jawny. Seal wykrywa zmianę i daje
HPA realne obciążenie CPU.

### Gdzie jest `seal.json`

W Blob Storage, kontener `drops`, ścieżka:

```text
drops/<id>/file
drops/<id>/meta.json
drops/<id>/seal.json
```

W `seal.json` są: `algorithm`, `iterations`, `digest`, `seal`, `sealedAt`, `pod`.
W UI zobaczysz to po rozwinięciu **Seal record**. Przez API:

```bash
ID=$(curl -s http://74.158.77.185/api/drops | jq -r '.items[0].id')
curl -s "http://74.158.77.185/api/drops/$ID" | jq .seal
```

Człowiek nie czyta tego bezpośrednio z Blob, bo Owner to control plane, nie data
plane. Runtime ma `Storage Blob Data Contributor`.

### Share

Link ma postać:

```text
/s/<id>?exp=<czas>&v=<wersja>&sig=<podpis>
```

- `id` — który drop,
- `exp` — kiedy wygasa (Unix seconds),
- `v` — wersja klucza,
- `sig` — HMAC-SHA256 po `id.exp.v`.

Link jest **bearer tokenem**: kto go ma, pobierze plik do wygaśnięcia. Nie ujawnia
klucza, ale jest credentialem — traktuj go jak hasło.

### Download i Verify

- Download: strumień bajtów z Blob. **Nie weryfikuje seal automatycznie.**
- Verify: przelicza SHA-256 i PBKDF2, porównuje z `seal.json`.
- Zmiana pliku → verify mówi „tampered”; download nadal zwróci zmienione bajty.
- Wygaśnięcie → 410. Zły podpis → 403. Wyłączona wersja klucza → 403.

---

## 4. Osiem zakładek — co klikasz i co mówisz

| # | Zakładka | Co klikasz | Co mówisz |
| --- | --- | --- | --- |
| 01 | **Drop** | upload, seal, Share, Open, Verify | „Upload → Blob, seal → integralność + CPU, link → HMAC z wersją klucza.” |
| 02 | **Blob** | Refresh stats, Write 20, soft-delete | „Prywatny kontener, shared key disabled, managed identity, lifecycle 30/90.” |
| 03 | **RBAC** | Run all three probes | „200, 200, 403 — runtime może dane, ale nie klucze konta.” |
| 04 | **Key Vault** | Refresh key state | „Wersja i fingerprint; rotacja nie łamie, disable rewokuje w ≤60 s.” |
| 05 | **Scaling** | Observe 20, Run 12s | „HPA 2–6, 60%; node 2 vCPU jest sufitem.” |
| 06 | **Cost** | The bill | „2,93 $/dzień; node 2,21, LB 0,60, IP 0,12; pody nie kosztują osobno.” |
| 07 | **Availability** | Drain / crash | „Readiness drenuje, liveness restartuje; jeden node to shared fate.” |
| 08 | **Delivery** | SHA, image | „Ten sam tag na AKS i ACA; ACA 401, AKS 200.” |

---

## 5. Scenariusz 12 minut — mów tak

### Otwarcie (90 s)

> „To jest Azulab Drop — aplikacja do udostępniania plików. Użytkownik wgrywa plik,
> aplikacja zapisuje go w Blob Storage, liczy seal i wydaje podpisany link, który
> wygasa.
>
> Seal to celowo wolny odcisk pliku: SHA-256 z bajtów, a potem PBKDF2 z 600 000
> iteracji. To nie szyfrowanie — to integralność i koszt CPU. Link jest podpisany
> HMAC-iem: serwer bierze klucz z Key Vault i liczy HMAC po id, expiry i wersji
> klucza. Podpis trafia do URL jako `sig`.
>
> Ten sam obraz z GHCR działa na dwóch runtime’ach: AKS i ACA. AKS daje
> Kubernetes — probes, PDB, HPA 2–6. ACA daje managed ingress, Easy Auth
> i scale-to-zero. Oba używają managed identity — na AKS przez Workload Identity —
> do Key Vault i Blob, więc w podzie nie ma sekretów.
>
> Koszt to około 2,93 $/dzień; jeden node i brak cluster autoscalera to świadome
> trade-offy.”

### 01 Drop (2 min)

**Klik:** upload `docs/azulab-interview-pack.md` → poczekaj na `SEALED` → Share →
Open → Verify.

**Mów:**
> „Upload zapisuje bajty w Blob; nazwa pliku jest tylko metadata. Seal to SHA-256
> plus PBKDF2 600k — integralność i celowy koszt CPU, nie szyfrowanie. Seal trwa
> około 300–400 ms. Link ma id, expiry, wersję klucza i HMAC. Otwieram link —
> plik się pobiera. Verify przelicza seal i porównuje z `seal.json`; download sam
> tego nie robi.”

### 02 Blob (1 min)

**Klik:** Refresh stats → Write 20 → Soft-delete round trip.

**Mów:**
> „Kontener `drops` jest prywatny, shared key jest wyłączony, aplikacja używa
> managed identity. Trzy bloby na drop: `file`, `meta.json`, `seal.json`.
> Lifecycle: Cool po 30 dniach, delete po 90. Soft-delete demo pokazuje, że
> usunięty blob można odzyskać.”

### 03 RBAC (2 min)

**Klik:** Run all three probes.

**Mów:**
> „Runtime to proces w podzie, który obsługuje request. Pierwszy probe czyta
> sekret z Key Vault — 200, bo ma `Key Vault Secrets User`. Drugi listuje bloby —
> 200, bo ma `Storage Blob Data Contributor`. Trzeci próbuje pobrać klucze konta
> storage — 403, bo to control-plane i runtime tego nie ma. Dzięki temu compromise
> poda nie daje klucza do całego konta. Owner też jest control plane, nie data
> plane.”

### 04 Key Vault (2 min)

**Klik:** Refresh key state.

**Mów:**
> „Wersja to konkretna wartość klucza. Fingerprint to krótki hash tej wartości,
> pokazany w UI, żeby widzieć zmianę bez ujawniania sekretu. `sig` w linku to
> HMAC, nie fingerprint. Rotacja tworzy nową wersję; stara zostaje w Key Vault.
> Nowe linki używają nowej wersji w ciągu 5 minut. Stare linki nadal działają, bo
> niosą swoją wersję. Wyłączenie starej wersji rewokuje jej linki w ciągu
> maksymalnie 60 sekund.”

### 05 Scaling (2 min)

**Klik:** Observe 20 → Run 12s of seals.

**Mów:**
> „HPA patrzy na CPU: min 2, max 6, target 60% requestu; request 100m, limit 300m.
> Po 12 s loadu CPU przekroczył 60%; HPA reaguje na ~15 s okno, więc często widać
> trzeci pod, a przy dłuższym obciążeniu dochodzi do 6. Wszystkie pody są na
> jednym node z 2 vCPU, więc dzielą te same rdzenie. HPA dodaje równoległość, nie
> moc: przy 6 podach rośnie throttling i latency. To demo kontraktu HPA; node jest
> sufitem. Cluster autoscaler dodałby node, ale tylko gdy pody są Pending — nie
> dlatego, że CPU jest wysokie.”

### 06 Cost (1 min)

**Klik:** The bill.

**Mów:**
> „2,93 $/dzień: node 2,21, LoadBalancer 0,60, public IP 0,12. Pody nie są osobną
> pozycją — płacę za node. ACA przy bezczynności jest 0, ale ma cold start.
> Budżet 50 $ to alert, nie limit. Lifecycle ogranicza storage.”

### 07 Availability (1 min)

**Klik:** Drain this pod (albo crash).

**Mów:**
> „Readiness sprawdza, czy pod może przyjmować ruch: klucz i Storage. Jeśli padnie,
> pod wypada z endpointów, ale nie jest restartowany. Liveness sprawdza tylko
> proces; jeśli padnie, kubelet restartuje kontener w tym samym podzie. PDB
> `minAvailable: 1` chroni drain, nie awarię node’a. Jeden node to shared fate:
> awaria node’a zabiera oba pody.”

### 08 Delivery (1 min)

**Klik:** SHA, image, pod.

**Mów:**
> „PR waliduje, main buduje obraz z tagiem SHA, CD wdraża ten sam tag na ACA i AKS,
> robi smoke test `/health` i `/ready`. ACA root zwraca 401, bo Easy Auth wymaga
> sesji; AKS root jest publiczny i zwraca 200. `/s/*` jest wyłączone z auth, bo
> link sam jest credentialem. Jedyny długotrwały sekret to client secret Easy Auth.”

---

## 6. Trudne pytania — krótkie odpowiedzi

**1. Dlaczego HMAC, a nie JWT albo sesja?**
> „Link musi nieść tylko id, expiry i wersję klucza. HMAC załatwia to jednym
> podpisem, bez biblioteki i bez bazy sesji. JWT też używa HMAC (HS256), ale
> dokłada format i claimy, których tu nie potrzebuję. Serwer jest jedynym
> weryfikatorem, więc symetryczny HMAC wystarcza.”

**2. Dlaczego PBKDF2, a nie bcrypt/Argon2?**
> „PBKDF2 jest w Node bez natywnego modułu, a tutaj nie hashuję haseł — potrzebuję
> kontrolowanego kosztu CPU i deterministycznego wyniku. bcrypt/Argon2 są lepsze
> do haseł, ale wymagają dodatkowej zależności. SHA-256 wystarcza do integralności;
> PBKDF2 dokładam świadomie jako work factor dla HPA.”

**3. Co się dzieje, gdy Key Vault padnie?**
> „Jeśli klucz jest w cache, linki dalej działają; cache jest oznaczony jako
> `stale`. Jeśli klucza nie ma, readiness robi się 503 i pod wypada z ruchu, a
> linki dostają 403. Liveness zostaje 200 — proces nie jest restartowany. Awaria
> nie rewokuje linków masowo; rewokacja to wyłączenie konkretnej wersji.”

**4. Owner vs data plane — dlaczego 403?**
> „Owner to control plane: tworzy zasoby i nadaje role, ale nie ma automatycznego
> dostępu do danych. Listowanie blobów to data plane i wymaga
> `Storage Blob Data Reader/Contributor`. Owner może sobie nadać taką rolę, ale to
> jawna, audytowana decyzja — nie skutek bycia Ownerem.”

**5. Rotacja vs rewokacja?**
> „Rotacja dodaje nową wersję klucza; stara zostaje w Key Vault i stare linki
> działają. Nowe linki przechodzą na nową wersję w ciągu 5 minut. Rewokacja to
> wyłączenie konkretnej wersji — linki z nią dostają 403 w ciągu maksymalnie 60 s.”

**6. Po co HPA na jednym node?**
> „To demo kontraktu: pokazuje metrykę, target, min/max i reakcję 2 → 6 → 2.
> HPA dodaje pody, nie moc; na jednym node pody dzielą 2 vCPU, więc rośnie
> throttling. W produkcji HPA współpracowałby z cluster autoscalerem, który
> dokłada node’y, gdy pody są Pending.”

**7. Readiness vs liveness?**
> „Readiness odpowiada: czy pod może przyjmować ruch? Sprawdza klucz i Storage;
> jak padnie, pod wypada z endpointów, ale nie jest restartowany. Liveness
> odpowiada: czy proces żyje? Sprawdza tylko `/health`; jak padnie, kubelet
> restartuje kontener w tym samym podzie. Dlatego liveness nie sprawdza
> zależności.”

**8. Skąd 2,93 $/dzień?**
> „Node 2,21, LoadBalancer 0,60, public IP 0,12. Pody nie kosztują osobno — płacę
> za node. ACA przy bezczynności jest 0, ale ma cold start. Budżet 50 $ to alert,
> nie limit.”

**9. Dlaczego Easy Auth ma sekret?**
> „Easy Auth jest confidential client i potrzebuje client secret albo certyfikatu;
> nie ma opcji managed identity. To jedyny długotrwały sekret platformy, trzymany
> w Container App secret store, rotowany rocznie.”

**10. Co byś zmienił w produkcji?**
> „Co najmniej 2–3 node’y w strefach dostępności, topology spread, cluster
> autoscaler, ingress z TLS, NetworkPolicy i private API server, Defender/Trivy
> w CI oraz GitOps zamiast `kubectl set image`.”

---

## 7. Częste pułapki

| Zamiast tego | Powiedz to |
| --- | --- |
| „3 nody” | **3 pody** na jednym node. |
| „seal to fingerprint” | Seal = odcisk pliku; fingerprint = hash klucza; `sig` = HMAC linku. |
| „rotacja usuwa stary klucz” | Rotacja dodaje nową wersję; stara zostaje w Key Vault. |
| „rotacja co 60 s” | Nowa wersja: 5 min; rewokacja: 60 s. |
| „HPA skaluje wertykalnie” | HPA skaluje **poziomo pody**. |
| „HPA dodaje moc” | HPA dodaje równoległość; node jest sufitem. |
| „cluster selector” | **cluster autoscaler**. |
| „brak endpointów = 403” | Brak endpointów = **503/timeout**. |
| „ACA 401 to błąd” | To Easy Auth; root wymaga sesji. |
| „PBKDF2 do haseł” | Tutaj PBKDF2 to **work factor** na digestcie pliku. |
| „seal dowodzi autorstwa” | Seal dowodzi integralności względem `seal.json`, nie autorstwa. |

---

## 8. Preflight — 15 minut przed rozmową

```bash
az aks show -g rg-azulab-dev-polandcentral -n aks-azulab-dev \
  --query powerState.code -o tsv

az aks get-credentials -g rg-azulab-dev-polandcentral -n aks-azulab-dev --overwrite-existing
kubectl get nodes
kubectl -n azulab get pods
kubectl -n azulab get hpa azulab

kubectl -n azulab get svc azulab || kubectl apply -f k8s/service.yaml
IP=$(kubectl -n azulab get svc azulab -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "http://$IP/"

curl -s "http://$IP/health"
curl -s "http://$IP/ready"
curl -s "http://$IP/version"
curl -s "http://$IP/api/config" | jq '{store,keyVault,keyVersion,keyFingerprint}'

ACA=https://ca-azulab-dev.bluesand-12892b79.polandcentral.azurecontainerapps.io
curl -s -o /dev/null -w "ACA /health %{http_code}\n" "$ACA/health"
curl -s -o /dev/null -w "ACA /       %{http_code}\n" "$ACA/"
```

### Checklist

- [ ] 1 node `Ready`, 2 pody `1/1 Running`
- [ ] HPA: `MINPODS 2`, `MAXPODS 6`, `TARGETS cpu: …/60%`
- [ ] `/ready` → `status: ready`, `keyVault: ok`, `storage: ok`
- [ ] `/api/config` → `store: azure`, `keyVault: keyvault`
- [ ] ACA `/health` 200, `/` 401
- [ ] podpisany link z AKS działa też na ACA
- [ ] `terraform plan` → `No changes`
- [ ] otwarte: UI AKS, ACA, GitHub Actions, evidence

### Plan B

| Problem | Reakcja |
| --- | --- |
| AKS nie wstaje | Pokaż evidence i screenshot; przejdź do RBAC/Key Vault na ACA. |
| Brak IP po odtworzeniu Service | `kubectl -n azulab get svc azulab -w` (2–4 min). |
| ACA cold start | Powtórz `curl` po 30–60 s. |
| Drop 503 | `/api/config` → `store` musi być `azure`; sprawdź `/ready`. |
| Link 403 | Sprawdź, czy wersja klucza nie jest wyłączona; porównaj `v=` z `/api/config`. |
| Pipeline czerwony | Nie naprawiaj na żywo; pokaż ostatni zielony run. |

---

## 9. Gdy nie wiesz, co powiedzieć

- „Tego nie implementowałem, ale wiem, jak bym to rozwiązał: …”
- „Sprawdzę to w UI/API — `/version` i `/ready` pokazują stan procesu.”
- „To jest świadomy trade-off; w produkcji wymagałoby to …”
- „Mogę pokazać kod i dokumentację, jeśli chcesz wejść głębiej.”

Nie improwizuj liczb. Lepiej powiedzieć „sprawdzę” niż podać złą wartość.
