# Deep dive: Key Vault + Blob Storage

W projekcie wybrano **dwa komponenty** i poznano na nich bezpieczeństwo
end to end. Te dwa są w ścieżce danych aplikacji i pokazują dwa różne modele
data plane: sekrety i bloby.

---

# Część 1 — Key Vault

## 1.1 Model bezpieczeństwa w sześciu warstwach

| Warstwa | Pytanie | Mechanizm |
| --- | --- | --- |
| **Tożsamość** | kto się łączy? | Entra ID: user, managed identity, service principal |
| **Autoryzacja** | co może? | Azure RBAC albo access policies (nie mieszaj) |
| **Sieć** | skąd może? | public endpoint, firewall, private endpoint, trusted services |
| **Ochrona danych** | co z zniszczeniem? | soft delete, purge protection, HSM |
| **Audyt** | kto co zrobił? | diagnostic logs → Log Analytics |
| **Cykl życia** | co dalej z sekretem? | wersje, expiry, rotation, disable, delete, purge |

## 1.2 Co mamy w Azulab (zmierzone, nie z dokumentacji)

| Kontrola | Wartość | Komenda |
| --- | --- | --- |
| Model autoryzacji | RBAC | `az keyvault show -n kv-azulab-dev-6mvarl --query properties.enableRbacAuthorization` |
| Purge protection | **true** | `... --query properties.enablePurgeProtection` |
| Soft delete | **7 dni** | `... --query properties.softDeleteRetentionInDays` |
| Public network | Enabled | `... --query properties.publicNetworkAccess` |
| Private endpoint | brak | — |
| Diagnostic logs | allLogs + AllMetrics | `az monitor diagnostic-settings list --resource <id>` |
| Rola aplikacji | `Key Vault Secrets User` | `az role assignment list --assignee 210841c3-...` |
| Rola człowieka | `Key Vault Administrator` (przez grupę `azulab-platform-admins`) | `az role assignment list --assignee <group-id>` |

## 1.3 Czego nie mamy (i dlaczego)

| Brak | Konsekwencja | Kiedy dodać |
| --- | --- | --- |
| Retencja 90 dni | 7 dni to minimum; Azure **nie pozwala zmienić** po utworzeniu | nowy sejf: 90 |
| Private endpoint | ruch idzie publicznym endpointem (TLS) | po przejściu AKS na Azure CNI |
| Automatyczna rotacja | sekret zmieniasz ręcznie + restart | Event Grid `SecretNearExpiry` → Function |
| Alert o wygaśnięciu | brak `expires` na sekrecie | przed produkcją |
| HSM / Premium | klucze w oprogramowaniu | gdy wymóg compliance |

## 1.4 Dowód z logów — „kto przeczytał sekret?"

To jest odpowiedź na pytanie „jak sprawdzić, czy sekret jest używany”.
Zapytanie KQL (zweryfikowane na żywym workspace):

```kusto
AzureDiagnostics
| where ResourceType == 'VAULTS'
| where OperationName in ('SecretGet', 'SecretList')
| project TimeGenerated, OperationName, ResultType, CallerIPAddress, identity_claim_oid_g
| order by TimeGenerated desc
| take 20
```

Wynik z 2026-11-03 (skrócony):

| TimeGenerated | Operation | Result | CallerIPAddress | identity_claim_oid_g |
| --- | --- | --- | --- | --- |
| 14:20:15 | SecretGet | Success | 74.248.73.251 | `210841c3-…` |
| 14:09:01 | SecretGet | Success | 74.248.73.251 | `210841c3-…` |
| 14:01:01 | SecretGet | Success | 172.160.193.21 | `210841c3-…` |

`210841c3-…` to **principalId** managed identity `id-azulab-dev-app`. Czyli log
pokazuje dokładnie: która tożsamość, z jakiego IP, kiedy i z jakim wynikiem
czytała sekret. Dwa różne IP to egress AKS (`172.160.193.21`) i Container Apps
(`74.248.73.251`).

## 1.5 Lab (bezpieczny, 10 min)

> Aplikacja Drop podpisuje linki sekretem `share-signing-key`. `app-message` to
> starszy sekret demo i tutaj służy tylko jako bezpieczny, read-only przykład.

```bash
# wersje sekretu — każda ma własne id, enabled, created
az keyvault secret list-versions \
  --vault-name kv-azulab-dev-6mvarl --name app-message \
  --query "[].{id:id, enabled:attributes.enabled, created:attributes.created}" -o table

# metadane bez wartości
az keyvault secret show \
  --vault-name kv-azulab-dev-6mvarl --name app-message \
  --query "{name:name, enabled:attributes.enabled, expires:attributes.expires, created:attributes.created}"

# czy purge protection naprawdę blokuje? (na usuniętym obiekcie)
az keyvault secret delete --vault-name kv-azulab-dev-6mvarl --name drill-secret
az keyvault secret purge  --vault-name kv-azulab-dev-6mvarl --name drill-secret
# oczekiwane: odmowa — purge protection jest włączone
```

Nie rób tego na `app-message`. Jeśli chcesz przejść pełny cykl, utwórz
`drill-secret`, a potem go odzyskaj (`az keyvault secret recover`).

## 1.6 Osiem pytań

1. Czym różni się RBAC od access policies i dlaczego mieszanie ich psuje dostęp?
2. Co dokładnie robi purge protection i dlaczego jest nieodwracalne?
3. Czym różni się `delete` od `purge`?
4. Jak sprawdzisz, która tożsamość czyta sekret?
5. Jak zrotować sekret bez przestoju?
6. Dlaczego `Contributor` nie może przeczytać sekretu?
7. Co się stanie, gdy sekret wygaśnie, a aplikacja ma go w cache?
8. Jak zaudytujesz 3000 nieużywanych sekretów?

---

# Część 2 — Blob Storage

## 2.1 Model bezpieczeństwa w sześciu warstwach

| Warstwa | Pytanie | Mechanizm |
| --- | --- | --- |
| **Tożsamość** | kto? | Entra ID |
| **Autoryzacja** | co może? | RBAC data-plane, SAS, shared key, anonymous |
| **Sieć** | skąd? | public access, firewall, private endpoint, service endpoint |
| **Ochrona danych** | co z przypadkowym delete? | soft delete, versioning, PITR, immutability |
| **Audyt** | kto czytał/pisał? | diagnostic logs, Defender for Storage |
| **Koszt** | gdzie trzymać? | hot / cool / cold / archive, lifecycle |

## 2.2 Co mamy w Azulab

| Kontrola | Wartość | Komenda |
| --- | --- | --- |
| Shared key | **false** | `az storage account show -n stazulabdev6mvarl -g rg-azulab-dev-polandcentral --query allowSharedKeyAccess` |
| Public blob access | **false** | `... --query allowBlobPublicAccess` |
| TLS | 1.2, HTTPS only | `... --query minimumTlsVersion` |
| Network default action | Allow (brak IP rules) | `... --query networkRuleSet.defaultAction` |
| Private endpoint | brak | — |
| Soft delete blobów | **7 dni** | `az storage account blob-service-properties show ...` |
| Soft delete kontenerów | **7 dni** | j.w. |
| Versioning | **true** | j.w. |
| Change feed | **true** | j.w. |
| Diagnostic logs | StorageWrite, StorageDelete | `az monitor diagnostic-settings list ...` |
| Rola aplikacji | `Storage Blob Data Contributor` | `az role assignment list` |

## 2.3 Czego nie mamy

| Brak | Konsekwencja | Kiedy dodać |
| --- | --- | --- |
| Firewall default deny | endpoint publiczny, ale wymaga tożsamości | po private endpoint |
| Private endpoint | ruch publiczny (TLS) | po Azure CNI |
| Defender for Storage | brak detekcji anomalii i malware | przed produkcją |
| Immutability (WORM) | brak ochrony compliance | gdy wymagane |
| Lifecycle management | stare wersje zostają | po ustaleniu retencji |
| PITR | brak przywracania do punktu w czasie | gdy dane krytyczne |

## 2.4 Lab — najbardziej pouczający test

```bash
# 1. Owner subskrypcji próbuje czytać bloby
az storage blob list --account-name stazulabdev6mvarl \
  --container-name demo --auth-mode login
# WYNIK: 403 — Owner to control plane, dane wymagają roli data-plane

# 2. klucze można wylistować (control plane)...
az storage account keys list -n stazulabdev6mvarl -g rg-azulab-dev-polandcentral \
  --query "[0].keyName"

# 3. ...ale klucz nie działa na data plane
KEY=$(az storage account keys list -n stazulabdev6mvarl \
  -g rg-azulab-dev-polandcentral --query "[0].value" -o tsv)
az storage blob list --account-name stazulabdev6mvarl \
  --container-name demo --account-key "$KEY"
# WYNIK: KeyBasedAuthenticationNotPermitted
```

To jeden z najważniejszych testów w całym projekcie: **shared key wyłączony nie
znaczy „klucz nie istnieje" — znaczy „klucz nie może się uwierzytelnić"**.
Klucz nadal jest widoczny w ARM dla principala z uprawnieniami control-plane, ale
każda próba użycia kończy się odmową. Kradzież klucza nie daje dostępu do danych.

## 2.5 Osiem pytań

1. Czym różni się shared key od Entra ID + RBAC?
2. Kiedy użyłbyś SAS zamiast RBAC?
3. Dlaczego allow-list „tylko moje IP" nie działa dla aplikacji w chmurze?
4. Co daje soft delete, a co versioning — i czym się różnią?
5. Jak działa private endpoint i czego wymaga po stronie sieci?
6. Co to jest `allow_nested_items_to_be_public`?
7. Jak sprawdzisz, kto usunął blob?
8. Kiedy przeniesiesz dane do cool/archive i jaki to ma wpływ na dostęp?

---

# Część 3 — Key Vault vs Blob Storage

| Aspekt | Key Vault | Blob Storage |
| --- | --- | --- |
| Obiekt | sekret, klucz, certyfikat | blob, kontener |
| Autoryzacja | RBAC lub access policies | RBAC data-plane, SAS, shared key, anonymous |
| Natywna rotacja | klucze i certyfikaty tak, sekrety nie | brak (wersje są, rotacji nie ma) |
| Ochrona przed delete | soft delete + purge protection | soft delete + versioning |
| Największa pułapka | mieszanie RBAC i access policies | traktowanie konta jak „bucket" i włączony shared key |
| Audyt | `SecretGet` / `SecretList` | `StorageWrite` / `StorageDelete` |
| Publiczny dostęp | firewall / private endpoint | public access + firewall / private endpoint |

---

# Część 4 — Odpowiedzi po 30 sekund

**Key Vault:**
> „Sekret ma cykl życia: create, use, rotate, expire, disable, delete, purge.
> Autoryzacja to RBAC na konkretnym sejfie, aplikacja ma `Secrets User`, nie
> `Administrator`. Purge protection blokuje trwałe usunięcie, a logi pokazują
> dokładnie, która tożsamość czytała sekret — sprawdziłem to zapytaniem KQL.
> W Terraformie zarządzam sejfem i RBAC, nie wartością sekretu."

**Blob Storage:**
> „Wyłączyłem shared key, więc nie ma klucza, który może uwierzytelnić dostęp do
> danych. Aplikacja używa Entra ID i roli `Storage Blob Data Contributor`.
> Publiczny dostęp do blobów jest wyłączony, włączone są soft delete i wersjonowanie.
> Sieć ograniczam private endpointem, bo allow-list na domowe IP nie działa dla
> PaaS — egress jest dynamiczny."

**RBAC (spinające oba):**
> „Principal + rola + scope. Owner jest control-plane i nie czyta blobów — to
> pokazałem komendą, która zwróciła 403. Aplikacja ma tylko role data-plane,
> a pipeline Contributor na jednym resource group, nie na subskrypcji."
