# Mapa Azure — gdzie podejrzeć zasoby, uprawnienia i bezpieczeństwo

Ten dokument mówi, **gdzie w Azure Portal i CLI** sprawdzić każdy Mechanizm,
którego używamy w projekcie, oraz **co realnie jest włączone**, a czego nie ma.
Stan na **2026-11-05**, subskrypcja Free Trial.

> **Zasada:** w Portalu tylko podglądaj. Nie klikaj `Save`, `Apply`, `Rotate`,
> `Delete` ani `Disable` w trakcie demo. Zmiany robimy komendami, świadomie.

---

## 1. Identyfikatory

| Element | Wartość |
| --- | --- |
| Subskrypcja | `f2c06f27-c982-4ecb-b81b-604acd6f52d3` |
| Tenant | `e86914e6-0f72-471f-8d4b-fab57014ff26` |
| Resource group | `rg-azulab-dev-polandcentral` |
| AKS | `aks-azulab-dev` (region `swedencentral`) |
| AKS node pool | `system`, VMSS `aks-system-32184980-vmss` |
| ACA | `ca-azulab-dev` (region `polandcentral`) |
| ACA environment | `cae-azulab-dev` |
| Key Vault | `kv-azulab-dev-6mvarl` |
| Storage | `stazulabdev6mvarl` |
| Log Analytics | `law-azulab-dev` |
| Application Insights | `appi-azulab-dev` (utworzony, ale aplikacja go nie instrumentuje) |
| Managed identity | `id-azulab-dev-app` |
| App registration | `azulab-web` |
| Grupy | `azulab-platform-admins`, `azulab-deployers`, `azulab-readers` |
| Budżet | `budget-azulab-dev` (50 $/mies.) |
| Obraz | `ghcr.io/fantazyoosh/azulab-fnt:<commit-sha>` |

### Pozostałe zasoby

| Zasób | Do czego |
| --- | --- |
| `stazulabtfstate6mvarl` | Storage dla Terraform state. Traktuj jak wrażliwy; nie pobieraj publicznie. |
| `873b4a1a-…-dashboard` | Dashboard w Azure Portal; nie jest częścią runtime. |
| `appi-azulab-dev` | Application Insights; utworzony, ale aplikacja nie wysyła do niego telemetrii. |

---

## 2. Resource group — punkt startowy

**Portal:** Resource groups → `rg-azulab-dev-polandcentral`

Co tu widzisz:

- **Overview** — lista wszystkich zasobów, regiony, typy.
- **Resources** — AKS, ACA, Key Vault, Storage, LAW, App Insights, managed identity.
- **Access control (IAM)** — kto ma jakie role na całej grupie.
- **Activity log** — kto co zmienił (control plane).
- **Tags** — wspólne tagi projektu.

**CLI:**

```bash
az resource list -g rg-azulab-dev-polandcentral \
  --query "[].{name:name,type:type,location:location}" -o table
```

Uwaga: AKS jest w `swedencentral`, reszta w `polandcentral`. Resource group
`rg-azulab-dev-polandcentral` to tylko nazwa; nie wymusza regionu.

---

## 3. AKS — klaster Kubernetes

**Portal:** Kubernetes services → `aks-azulab-dev`

| Miejsce | Co sprawdzić |
| --- | --- |
| **Overview** | wersja Kubernetes, API server endpoint, liczba node’ów |
| **Node pools** | pool `system`, 1 node, `Standard_D2as_v5` (2 vCPU / 8 GiB), autoscaling **off** |
| **Workloads** | Deployment `azulab`, pody, ich stan |
| **Configuration** | OIDC issuer, Workload Identity |
| **Access control (IAM)** | role control-plane na klastrze |
| **Diagnose and solve problems** | health, restarty, eventy |
| **Logs / Monitor** | logi control-plane w `law-azulab-dev` |

**CLI — to jest najszybszy dowód:**

```bash
kubectl get nodes -o wide
kubectl -n azulab get deploy,rs,pods,svc,pdb,hpa -o wide
kubectl -n azulab get hpa azulab
kubectl -n azulab describe pod <pod>
kubectl -n azulab exec deploy/azulab -- env | grep AZURE_
```

### Co jest włączone

- OIDC issuer + Workload Identity.
- Jeden node, Free tier control plane.
- Standard LoadBalancer.
- Probes: `/health` (liveness/startup), `/ready` (readiness).
- PDB `minAvailable: 1`.
- HPA 2–6, CPU 60%.
- Diagnostyka control-plane: `kube-audit-admin` + kategoria `cluster-autoscaler`
  (autoscalera nie ma, więc ta kategoria nie produkuje danych).

### Świadome ograniczenia (lab)

- **Jeden node**, brak stref dostępności.
- **Brak cluster autoscalera** (`auto_scaling_enabled = false`).
- **kubenet**, brak NetworkPolicy.
- **Publiczny API server**, brak private cluster.
- **Local accounts enabled** (`disableLocalAccounts: false`).
- Brak Container Insights na node’ach; audit log jest, metryki node’ów nie.

To nie są przeoczenia — to decyzje kosztowe. W produkcji: 2–3 node’y w strefach,
cluster autoscaler, private API, NetworkPolicy, Azure RBAC for Kubernetes.

---

## 4. ACA — Azure Container Apps

**Portal:** Container Apps → `ca-azulab-dev`

| Miejsce | Co sprawdzić |
| --- | --- |
| **Overview** | publiczny FQDN, rewizja, replicas |
| **Revisions and replicas** | aktywna rewizja, obraz, replicas |
| **Ingress** | external ingress, target port 8080, HTTPS |
| **Authentication** | Easy Auth / Entra ID, excluded paths |
| **Scale** | min 0, max 2 |
| **Secrets** | `microsoft-provider-authentication-secret` (wartości nie podglądaj) |
| **Identity** | user-assigned `id-azulab-dev-app` |
| **Logs** | console logs w `law-azulab-dev` |

**CLI:**

```bash
az containerapp show -g rg-azulab-dev-polandcentral -n ca-azulab-dev \
  --query "{image:properties.template.containers[0].image,revision:properties.latestRevisionName,min:properties.template.scale.minReplicas,max:properties.template.scale.maxReplicas}" -o json

az containerapp auth show -g rg-azulab-dev-polandcentral -n ca-azulab-dev \
  --query "globalValidation.excludedPaths" -o tsv

az containerapp revision list -g rg-azulab-dev-polandcentral -n ca-azulab-dev -o table
```

### Co jest włączone

- Easy Auth z Entra ID; root i `/api/*` wymagają sesji.
- Wyjątki: `/health`, `/ready`, `/s/*`.
- Scale-to-zero: `min_replicas = 0`, `max_replicas = 2`.
- Jeden długotrwały sekret: client secret Easy Auth w Container App secret store.
- Ten sam obraz co AKS.

### Co pamiętać

- **Cold start** po bezczynności: pierwszy request tworzy replikę; 30–60 s.
- Root `/` zwraca **401** (albo redirect do logowania) — to nie błąd.
- `/s/*` jest anonimowe, bo podpisany link jest credentialem.

---

## 5. Key Vault

**Portal:** Key Vaults → `kv-azulab-dev-6mvarl`

| Miejsce | Co sprawdzić |
| --- | --- |
| **Objects → Secrets** | `share-signing-key`, `app-message` (legacy) |
| **Secret → Versions** | wersje, `Enabled`, data utworzenia; **nie podglądaj wartości** |
| **Access control (IAM)** | `Key Vault Secrets User` dla runtime, `Key Vault Administrator` dla grupy adminów |
| **Networking** | publiczny endpoint, network ACL domyślnie Allow, brak private endpoint |
| **Properties** | RBAC authorization, purge protection, soft delete 7 dni |
| **Diagnostic settings** | all logs + metrics → `law-azulab-dev` |
| **Logs** | `SecretGet`, `SecretList`, caller OID |

**CLI:**

```bash
az keyvault show -n kv-azulab-dev-6mvarl \
  --query "{rbac:properties.enableRbacAuthorization,purge:properties.enablePurgeProtection,softDelete:properties.softDeleteRetentionInDays,public:properties.publicNetworkAccess}" -o json

az keyvault secret list-versions --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key \
  --query "[].{version:version,enabled:attributes.enabled,created:attributes.created}" -o table

az keyvault secret show --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key \
  --query "{name:name,enabled:attributes.enabled,created:attributes.created}"
```

Ostatnia komenda **nie pokazuje wartości** — tylko metadane. Wartości nie
wyświetlaj na demo.

### Co jest włączone

- RBAC authorization (nie access policies).
- Purge protection + soft delete 7 dni.
- Diagnostyka do Log Analytics.
- Wersjonowanie sekretu; rotacja i disable wersji.

### Czego nie ma

- Private endpoint / firewall.
- Klucza zarządzanego przez HSM (Standard SKU).
- Automatycznej rotacji (robimy ją komendą).

---

## 6. Storage Account

**Portal:** Storage accounts → `stazulabdev6mvarl`

| Miejsce | Co sprawdzić |
| --- | --- |
| **Data storage → Containers** | `demo` (legacy), `drops` (produkt) |
| **Data protection** | versioning, soft delete 7 dni, change feed |
| **Lifecycle management** | `drops-retention`: Cool 30 d, delete 90 d |
| **Configuration** | `Allow shared key access = Disabled`, TLS 1.2, public blob access off |
| **Networking** | publiczny endpoint; network default Allow; opcjonalna allow-lista IP |
| **Access control (IAM)** | `Storage Blob Data Contributor` dla runtime |
| **Diagnostic settings** | `StorageWrite`, `StorageDelete` → LAW |
| **Storage browser** | podgląd blobów (jeśli masz rolę data-plane) |

**CLI:**

```bash
az storage account show -n stazulabdev6mvarl -g rg-azulab-dev-polandcentral \
  --query "{sku:sku.name,tls:minimumTlsVersion,sharedKey:allowSharedKeyAccess,publicBlob:allowBlobPublicAccess,https:supportsHttpsTrafficOnly}" -o json

az storage container list --account-name stazulabdev6mvarl --auth-mode login -o table

az storage account management-policy show \
  --account-name stazulabdev6mvarl -g rg-azulab-dev-polandcentral -o json \
  | jq '.policy.rules[] | {name,enabled,prefix:.definition.filters.prefixMatch,cool:.definition.actions.baseBlob.tierToCool.daysAfterCreationGreaterThan,delete:.definition.actions.baseBlob.delete.daysAfterCreationGreaterThan}'
```

### Co jest włączone

- Shared key **disabled** — brak „master password”.
- Public blob access **off**; kontenery prywatne.
- TLS 1.2, HTTPS only.
- Versioning + soft delete 7 dni.
- Lifecycle: Cool 30 d, delete 90 d.
- Runtime: `Storage Blob Data Contributor` przez managed identity.

### Czego nie ma

- Private endpoint.
- ZRS/RA-GRS (jest LRS).
- Immutability/WORM.
- Pełnego `StorageRead` w logach (świadomie wyłączone — koszt).

### Ważne

Owner subskrypcji **nie czyta blobów** bez roli data-plane. To jest celowe:

```bash
az storage blob list --account-name stazulabdev6mvarl --container-name drops --auth-mode login
# 403 — control plane ≠ data plane
```

---

## 7. Log Analytics i Application Insights

**Portal:** Log Analytics workspaces → `law-azulab-dev` → **Logs**

Retencja: **30 dni**. Zbieramy:

- Key Vault: wszystkie logi + metryki,
- AKS control plane: `kube-audit-admin` + `cluster-autoscaler`,
- Storage Blob: `StorageWrite`, `StorageDelete`,
- ACA: logi konsoli przez environment.

### Key Vault — kto czytał sekret

```kusto
AzureDiagnostics
| where ResourceType == "VAULTS"
| where OperationName in ("SecretGet", "SecretList")
| project TimeGenerated, OperationName, ResultType, CallerIPAddress, identity_claim_oid_g
| order by TimeGenerated desc
| take 20
```

### Storage — kto pisał / usuwał

```kusto
AzureDiagnostics
| where ResourceType has "STORAGE"
| where OperationName in ("PutBlob", "DeleteBlob")
| project TimeGenerated, OperationName, ResultType, CallerIPAddress, identity_claim_oid_g
| order by TimeGenerated desc
| take 20
```

### AKS — mutacje w control plane

```kusto
AzureDiagnostics
| where ResourceType == "MANAGEDCLUSTERS"
| where Category == "kube-audit-admin"
| project TimeGenerated, OperationName, ResultType, CallerIPAddress
| order by TimeGenerated desc
| take 20
```

**Application Insights:** `appi-azulab-dev` istnieje, ale aplikacja **nie ma SDK**
i nie wysyła do niego telemetrii. Nie oczekuj requestów/trace’ów. Głównym źródłem
jest Log Analytics i logi kontenera.

---

## 8. Uprawnienia — gdzie sprawdzić i co jest

### Portal

- **Subskrypcja → Access control (IAM) → Role assignments** — wszystkie role.
- **Resource group → Access control (IAM)** — role na RG.
- **Konkretny zasób → Access control (IAM)** — role na zasobie.
- **Check access** — wybierz użytkownika/identity i zobacz efekt.
- **Activity log** — kto zmienił zasób (control plane).

### CLI

```bash
az role assignment list --all \
  --query "[].{principal:principalName,role:roleDefinitionName,scope:scope}" -o table

# runtime identity
OID=$(az identity show -g rg-azulab-dev-polandcentral -n id-azulab-dev-app --query principalId -o tsv)
az role assignment list --assignee "$OID" --all -o table

# pipeline SP i grupa
az ad group list --query "[?displayName=='azulab-deployers'].{name:displayName,id:id}" -o table
```

### Role w tym projekcie

| Principal | Rola | Scope |
| --- | --- | --- |
| `azulab-platform-admins` (grupa) | Key Vault Administrator | sejf |
| `azulab-deployers` (grupa) | Contributor | resource group |
| `azulab-readers` (grupa) | Reader | resource group |
| `id-azulab-dev-app` | Key Vault Secrets User | sejf |
| `id-azulab-dev-app` | Storage Blob Data Contributor | konto storage |
| człowiek (Owner) | Owner | subskrypcja — **control plane** |

Pipeline ma **zero bezpośrednich ról** — dziedziczy Contributor z grupy.
Runtime ma tylko role data-plane. Człowiek jest Ownerem, ale nie ma roli
data-plane do blobów.

**Uczciwa uwaga:** Owner może sobie nadać rolę data-plane, jeśli ma uprawnienia
do `roleAssignments/write`. To nie jest twarda granica bezpieczeństwa — to jawna,
audytowana decyzja. W produkcji ograniczasz to przez PIM/conditions.

---

## 9. Bezpieczeństwo — stan faktyczny

### Włączone

- **Key Vault:** RBAC, purge protection, soft delete 7 d, diagnostyka.
- **Storage:** shared key off, public blob off, TLS 1.2, prywatne kontenery,
  versioning, soft delete, lifecycle.
- **AKS:** Workload Identity, OIDC, brak sekretów w klastrze, probes, PDB,
  audit log control-plane.
- **ACA:** Easy Auth z Entra ID, `/s/*` jako wąski wyjątek.
- **GitHub:** OIDC do Azure (brak client secret), secret scanning + push
  protection **włączone**.
- **CI:** testy, lint, docker build, `terraform fmt/validate`.

### Świadome luki

| Luka | Stan | Gdzie sprawdzić / co zrobić |
| --- | --- | --- |
| Defender for Containers / Storage / Key Vault | brak płatnych planów | Defender for Cloud → Environment settings → Defender plans; `az security pricing list` |
| Skanowanie obrazu (Trivy/Grype) | brak | dodać krok w CI przed push |
| SBOM | brak | Syft/Trivy w CI |
| CodeQL / SAST | brak | GitHub → Code security → CodeQL |
| Dependabot security updates | **disabled** | GitHub → Settings → Code security and analysis |
| `npm audit` w CI | brak | dodać krok `npm audit --omit=dev` |
| Checkov/tfsec dla Terraform | brak | dodać do PR checks |
| Private endpoints | brak | Portal → Networking → Private endpoint |
| NetworkPolicy | brak (`networkPolicy: none`) | AKS → Network profile; wymaga CNI z policy |
| Private API server | brak (`enablePrivateCluster: false`) | AKS → Networking |
| PIM / just-in-time Owner | brak | Entra ID → PIM (wymaga licencji) |
| Multi-AZ / drugi node | brak | AKS → Node pools → zones; koszt |

### GitHub — stan skanowania

Sprawdzone przez API:

```bash
gh api repos/Fantazyoosh/azulab-fnt --jq '.security_and_analysis'
```

Wynik:

- `secret_scanning`: **enabled**
- `secret_scanning_push_protection`: **enabled**
- `dependabot_security_updates`: **disabled**
- `secret_scanning_non_provider_patterns`: disabled
- `secret_scanning_validity_checks`: disabled

Włączanie:

- GitHub → repo → **Settings → Code security and analysis**:
  Dependabot alerts, Dependabot security updates, CodeQL, secret scanning.
- Defender for Cloud → **Environment settings** → wybierz subskrypcję →
  Defender plans (Containers, Storage, Key Vault).
- Azure Policy → **Compliance** — zobaczysz wbudowaną politykę
  `SecurityCenterBuiltIn`.

---

## 10. Szybki audyt — jedna sekwencja

```bash
RG=rg-azulab-dev-polandcentral

# 1. Co jest w grupie
az resource list -g "$RG" --query "[].{name:name,type:type,location:location}" -o table

# 2. AKS
az aks show -g "$RG" -n aks-azulab-dev \
  --query "{version:currentKubernetesVersion,nodeCount:agentPoolProfiles[0].count,autoscaling:agentPoolProfiles[0].enableAutoScaling,private:apiServerAccessProfile.enablePrivateCluster,localAccounts:disableLocalAccounts}" -o json
kubectl -n azulab get deploy,pods,hpa,pdb,svc

# 3. ACA
az containerapp show -g "$RG" -n ca-azulab-dev \
  --query "{image:properties.template.containers[0].image,min:properties.template.scale.minReplicas,max:properties.template.scale.maxReplicas}" -o json
az containerapp auth show -g "$RG" -n ca-azulab-dev \
  --query "globalValidation.excludedPaths" -o tsv

# 4. Key Vault
az keyvault show -n kv-azulab-dev-6mvarl \
  --query "{rbac:properties.enableRbacAuthorization,purge:properties.enablePurgeProtection,softDelete:properties.softDeleteRetentionInDays}" -o json
az keyvault secret list-versions --vault-name kv-azulab-dev-6mvarl \
  --name share-signing-key --query "[].{version:version,enabled:attributes.enabled}" -o table

# 5. Storage
az storage account show -n stazulabdev6mvarl -g "$RG" \
  --query "{sku:sku.name,tls:minimumTlsVersion,sharedKey:allowSharedKeyAccess,publicBlob:allowBlobPublicAccess}" -o json

# 6. RBAC
OID=$(az identity show -g "$RG" -n id-azulab-dev-app --query principalId -o tsv)
az role assignment list --assignee "$OID" --all -o table

# 7. Security / scanning
az security pricing list -o table
az policy assignment list -o table
gh api repos/Fantazyoosh/azulab-fnt --jq '.security_and_analysis'
```

---

## 11. Co pokazać w 5 minut

1. **AKS → Workloads**: 2 pody, HPA 2–6; `kubectl get hpa`.
2. **ACA → Authentication**: Easy Auth, excluded paths `/health`, `/ready`, `/s/*`.
3. **Key Vault → Secrets → Versions**: wersje klucza, `Enabled`; bez wartości.
4. **Storage → Containers**: `drops`; **Lifecycle management**: 30/90; **Configuration**: shared key disabled.
5. **Log Analytics → Logs**: `SecretGet` z OID identity runtime.
6. **RBAC → IAM**: runtime ma tylko dwie wąskie role; pipeline przez grupę.
7. **GitHub → Code security**: secret scanning on; brak Trivy/SBOM — uczciwie.

To jest mapa. Nie musisz jej znać na pamięć — wystarczy wiedzieć, **gdzie
kliknąć**, i umieć powiedzieć, **czego szukasz**.
