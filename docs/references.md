# References — the mentor's reading list

During the 2026-11-01 call the mentor shared links on screen. The transcript
captured the topics, not the URLs. The list below is the official Microsoft Learn
documentation that matches each topic he raised; every link was checked and
returns HTTP 200 on 2026-11-03.

Read with a question in hand. After each page, write one sentence in your own
words and run one command that proves it.

---

## Evening 1 — RBAC (foundation)

| Link | What it answers |
| --- | --- |
| [Azure RBAC overview](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview) | principal, role definition, scope, role assignment |
| [Scope overview](https://learn.microsoft.com/en-us/azure/role-based-access-control/scope-overview) | management group → subscription → RG → resource, inheritance |
| [Control plane and data plane](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/control-plane-and-data-plane) | why `Contributor` cannot read a secret or a blob |
| [Built-in roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles) | the exact role names used in this project |
| [Custom roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/custom-roles) | when a built-in role is too broad |
| [Deny assignments](https://learn.microsoft.com/en-us/azure/role-based-access-control/deny-assignments) | deny beats allow; managed apps use it |
| [Privileged Identity Management](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) | least privilege *in time*, not only in scope |

**Exercise:** run `az role assignment list --assignee <id> --all -o table` for the
pipeline identity and for the app identity. Explain why the first one cannot read
blobs and the second one cannot create resources.

### Entra ID groups (the layer above RBAC)

| Link | What it answers |
| --- | --- |
| [Manage groups](https://learn.microsoft.com/en-us/entra/fundamentals/how-to-manage-groups) | create security groups, add and remove members |
| [Assign Azure roles using the portal](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal) | group-based assignment in practice |
| [Entra RBAC best practices](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices) | least privilege, separation of duties |

**Exercise:** `az ad group member check --group azulab-deployers --member-id <sp>`
returns true, while `az role assignment list --assignee <sp>` is empty. Explain
both results in one sentence.

---

## Evening 2 — Key Vault (lifecycle)

| Link | What it answers |
| --- | --- |
| [Key Vault overview](https://learn.microsoft.com/en-us/azure/key-vault/general/overview) | vaults, HSM, the three object types |
| [Azure RBAC vs access policies](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide) | the two authorization models and why mixing them breaks |
| [About secrets](https://learn.microsoft.com/en-us/azure/key-vault/secrets/about-secrets) | versions, `nbf`/`exp`, no native rotation |
| [About keys](https://learn.microsoft.com/en-us/azure/key-vault/keys/about-keys) | cryptographic keys, rotation policy |
| [About certificates](https://learn.microsoft.com/en-us/azure/key-vault/certificates/about-certificates) | lifetime actions |
| [Soft-delete overview](https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview) | deleted vs purged, retention |
| [Security features](https://learn.microsoft.com/en-us/azure/key-vault/general/security-features) | purge protection, isolation, best practices |
| [Network security](https://learn.microsoft.com/en-us/azure/key-vault/general/network-security) | firewall, private endpoint, trusted services |
| [Diagnostic logging](https://learn.microsoft.com/en-us/azure/key-vault/general/logging) | `SecretGet`, `SecretList`, who read what |
| [Event Grid notifications](https://learn.microsoft.com/en-us/azure/key-vault/general/event-grid-overview) | `SecretNearExpiry` → rotation automation |

**Exercise:** `az keyvault secret list-versions` on a test secret; disable one
version and watch the app's next read fail; try `az keyvault secret purge` and see
purge protection refuse it.

---

## Evening 3 — Blob Storage (data plane)

| Link | What it answers |
| --- | --- |
| [Security recommendations for Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/security-recommendations) | the checklist the mentor was describing |
| [Authorize access to data](https://learn.microsoft.com/en-us/azure/storage/common/authorize-data-access) | Entra ID, SAS, shared key, anonymous — when each is valid |
| [Prevent shared key authorization](https://learn.microsoft.com/en-us/azure/storage/common/shared-key-authorization-prevent) | what breaks when you disable it |
| [Configure network security](https://learn.microsoft.com/en-us/azure/storage/common/storage-network-security) | firewall, IP rules, trusted services |
| [Private endpoints](https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints) | the correct answer to "allow only my IP" |
| [Soft delete for blobs](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview) | recover a deleted blob |
| [Blob versioning](https://learn.microsoft.com/en-us/azure/storage/blobs/versioning-overview) | every overwrite is a version |
| [Immutable storage](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview) | WORM for compliance |
| [Access tiers](https://learn.microsoft.com/en-us/azure/storage/blobs/access-tiers-overview) | hot/cool/cold/archive and the cost trade-off |
| [Defender for Storage](https://learn.microsoft.com/en-us/azure/defender-for-cloud/defender-for-storage-introduction) | anomaly detection and malware scanning |

**Exercise:** as the subscription Owner, try `az storage blob list --auth-mode
login`. It returns 403. Owner is control-plane; data needs
`Storage Blob Data Reader`. That single command explains the whole
control-plane/data-plane distinction.

---

## Well-Architected Framework (the frame for every answer)

| Link | Filar |
| --- | --- |
| [Azure Well-Architected](https://learn.microsoft.com/en-us/azure/well-architected/) | overview and the review framework |
| [Security](https://learn.microsoft.com/en-us/azure/well-architected/security/) | identity, network, data, monitoring |
| [Reliability](https://learn.microsoft.com/en-us/azure/well-architected/reliability/) | failure modes, recovery, RTO/RPO |
| [Cost Optimization](https://learn.microsoft.com/en-us/azure/well-architected/cost-optimization/) | pay for what you use |
| [Operational Excellence](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/) | IaC, CI/CD, observability |
| [Performance Efficiency](https://learn.microsoft.com/en-us/azure/well-architected/performance-efficiency/) | scaling, load testing |

**How to use it:** do not recite the pillars. Pick a trade-off from this project
and place it on two axes. Example: single-region AKS is cheap (Cost) but has a
high RTO (Reliability); adding a second region would multiply the node cost.

---

## AKS and OIDC (the runtime and the pipeline)

| Link | What it answers |
| --- | --- |
| [AKS Workload Identity](https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview) | federated credential, ServiceAccount annotation, projected token |
| [AKS security concepts](https://learn.microsoft.com/en-us/azure/aks/concepts-security) | control plane, node, pod, network layers |
| [AKS cluster security best practices](https://learn.microsoft.com/en-us/azure/aks/operator-best-practices-cluster-security) | the production checklist |
| [GitHub OIDC with Azure](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect) | issuer, subject, audience |
| [GitHub: configuring OIDC in Azure](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-azure) | the GitHub side |

---

## Reading plan

| Day | 45 minutes | Output |
| --- | --- | --- |
| 1 | RBAC overview + control/data plane + built-in roles | explain why Owner cannot read a blob |
| 2 | Key Vault soft delete + security features + RBAC guide | explain create → purge, and why purge protection is irreversible |
| 3 | Blob security recommendations + shared key + private endpoints | explain why "allow my IP" fails for PaaS |
| 4 | WAF security + reliability | place three project trade-offs on the pillars |
| 5 | AKS workload identity + OIDC | explain the token exchange without notes |

Then run `docs/drill-rbac-kv.md` out loud. If an answer takes more than 60
seconds, the page was not read carefully enough.
