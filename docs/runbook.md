# Runbook — co sprawdzam przy wdrożeniu (krok po kroku)

Ma być czytane **przed** merge, a potem **w trakcie** pipeline. Żadnych skrótów.

Skróty: **IaC** = Infrastructure as Code (teraz: Terraform). **CI/CD** = automatyczne testy i wdrożenia. **SHA** = identyfikator commita. **Revision** = wersja wdrożenia w Container Apps. **Probe** = sonda zdrowia Container Apps.

---

## Faza 0 — Przed pushem

- [ ] Zmiana ma sens i wiadomo, dlaczego ją robisz.
- [ ] Commit message mówi co i dlaczego.
- [ ] `npm test` przechodzi lokalnie (6/6).
- [ ] `docker build` przechodzi lokalnie (`azulab:local`).
- [ ] `terraform fmt` nie zgłasza błędów.
- [ ] `terraform validate` OK.
- [ ] Brak sekretów w plikach (np. `AZURE_CLIENT_SECRET`, tokeny, hasła).

Jeśli któryś punkt nie przechodzi — nie pushuj, bo pipeline i tak padnie.

---

## Faza 1 — Pull Request (pipeline PR)

1. `pr.yml` uruchamia się po otwarciu PR.
2. Sprawdza:
   - **Lint** — czy kod się parse-uje i syntax jest OK.
   - **Testy** (unit tests).
   - **Docker build** (obraz się buduje).
   - **Terraform** (`fmt` + `validate`).
3. Jeśli wszystko zielone — merge.

Czego sprawdzam:
- Brak błędów lint/test.
- Obraz zbudowany (bez pushu).
- Terraform bez błędów formatowania.
- Pipeline trwa < 5 min.

Jeśli utnie się:
- Lint fail → popraw syntax, commit, push.
- Test fail → powtórz lokalnie, napraw, push.
- Docker fail → sprawdź Dockerfile.
- Terraform fail → sprawdź `fmt` lub `validate`.

---

## Faza 2 — CI (na main)

1. `ci.yml` uruchamia testy ponownie.
2. Buduje obraz i pushuje do GHCR z **immutable tag = SHA commitu**.
3. Publikuje wynik.

Czego sprawdzam:
- Tag to pełny SHA (40 znaków hex), **nie** `latest`.
- Obraz istnieje w GHCR i ma digest.
- Brak zmiennych-sekretów w definicji pipeline (OIDC only).
- Pipeline trwa < 10 min.

Jeśli utnie się:
- Build fail → sprawdź Dockerfile i deps (`npm ci`).
- Push fail → sprawdź write access (OIDC).
- Tag fail → sprawdź `docker/metadata-action`.

---

## Faza 3 — CD (deploy + smoke)

1. `cd.yml` uruchamia się po CI.
2. Loguje się do Azure z OIDC (bez sekretu).
3. Wdraża obraz jako nową rewizję.
4. Czeka na zdrowie.
5. Smoke:
   - `GET /health` → 200
   - `GET /ready` → 200
6. Wyświetla listę rewizji.

Czego sprawdzam:
- Nowa rewizja jest **Healthy**.
- Ingress **target port** pasuje do aplikacji (u nas `8080` dla realnej appki).
- Liveness probe `/health` na `8080`.
- Readiness probe `/ready` na `8080`.
- Smoke `/health` → 200 w < 60 s.
- `/ready` → 200 po pierwszych sukcesach (successThreshold).
- `/api/message` → odpowiedź z Key Vault.
- `/api/blobs` → zapis/odczyt/listowanie/usuwanie.

Jeśli utnie się:
- Unhealthy → sprawdź probe (port/path), potem logi.
- `/ready` 503 → Key Vault, RBAC, `KEY_VAULT_URL`, `AZURE_CLIENT_ID`.
- Blob 401/403 → sprawdź managed identity + RBAC storage.
- Timeout → ingress target port, cold start.

---

## Faza 4 — Rollback (obowiązkowy trening)

1. Wdróż v2 (zmiana komunikatu).
2. Wdróż v3 z zepsutym `/health`.
3. Obserwuj, czy platforma się czerwoni albo `Unhealthy`.
4. Cofnij:
   - activate previous revision
   - albo redeploy previous SHA.
5. Weryfikuj `/health` 200 i `/ready` 200.
6. Zapisz czas w `docs/rollback-log.md`.

Czego sprawdzam:
- Czas od wykrycia do przywrócenia (cel: < 5 min).
- Brak spadku ruchu (jeśli staging → prod, sprawdź smoke po rollbacku).
- Poprzednia rewizja widoczna i dostępna.

---

## Faza 5 — Po deployu

- [ ] `terraform plan` nie pokazuje nieoczekiwanych zmian (drift).
- [ ] Zasoby w portalu widoczne i policy correct:
  - RG
  - Container App
  - Environment
  - Storage
  - Key Vault
  - Log Analytics
  - App Insights
  - Managed Identity
  - Role assignments.
- [ ] Orphan Log Analytics usunięty.
- [ ] Budget alert ustawiony (mail lub portal).
- [ ] Koszt dnia zapisany (screenshot).

---

## Trzy częste błędy i co zrobić

1. **Zły target port / sonda**  
   Objaw: app mówi `Listening on :8080`, ingress targetuje `80`.  
   Fix: spójnie app + ingress + sonda.

2. **Brak managed identity w Azure SDK**  
   Objaw: `ManagedIdentityCredential: Unable to load proper Managed Identity`.  
   Fix: Container App ma user-assigned identity i env `AZURE_CLIENT_ID`.

3. **Storage list fails, upload działa**  
   Objaw: `getBlobClient` tworzy Block Blob Client z `undefined`.  
   Fix: tworzyć Block Blob Client dopiero, gdy masz `name`.

---

## Co i jak zapisywać na rozmowę

- Każdy deploy = commit SHA.
- Rollback = czas + co zepsuliśmy + jak zapobiec.
- Koszt = screenshot + kwota.
- Dobro customy = „hands-on lab, not enterprise production" (uczciwe ograniczenie).

## Szybka ściąga przy stole

- `/health`: sonda liveness, czy proces żyje.
- `/ready`: czy gotowy na ruch (Key Vault, config, managed identity).
- `/api/message`: sekret z Key Vault przez managed identity.
- `/api/blobs`: CRUD na plikach z RBAC.
- rollback: aktywuj poprzednią rewizję.
- OIDC: issuer + subject + audience, bez sekretu.
- managed identity: no secret, ID card.
- RBAC: najmniejsze możliwe uprawnienie.
- scale-to-zero: zero ruchu = zero compute cost.  
EOF
echo "runbook.md written"
