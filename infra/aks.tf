# AKS — the Kubernetes runtime for the Azulab demo.
#
# Why northcentralus:
#   This subscription is an Azure Free Trial (quotaId FreeTrial_2014-09-01).
#   General-purpose VM sizes are restricted per region and per offer. Every
#   AKS-capable region was cross-checked against Microsoft.Compute/skus and
#   the Retail Prices API; the cheapest node this subscription may actually
#   create is Standard_D2pls_v6 in northcentralus at $0.062/h (2 vCPU /
#   4 GiB, Arm64). AKS accepts Arm64 system node pools (validated on
#   2026-11-07), and every AKS system image is multi-arch. The application
#   image is published for linux/amd64 and linux/arm64 (see CI).
#
#   The resource group stays in polandcentral — a logical container, not a
#   location constraint for the resources inside it. Key Vault, Storage and
#   Log Analytics stay there; the cross-region calls are small and cached.
#
# Deliberate trade-offs:
#   * Free tier control plane -> no SLA, zero control-plane cost (lab budget).
#   * One node                 -> no node-level HA; pod-level HA via 2 replicas.
#   * 30 GiB OS disk           -> the P10 128 GiB default costs ~4x more for
#                                 no benefit in a lab.
#   * Arm64                    -> cheapest allowed SKU, but the image must stay
#                                 multi-arch and the HPA demo runs on Cobalt.
#   * kubenet                  -> no VNet/subnet design needed for a lab.
#                                 Production would use Azure CNI Overlay.
#   * Public API server        -> private cluster costs more and complicates
#                                 the demo; documented as a next step.

resource "azurerm_kubernetes_cluster" "main" {
  name                = "aks-${local.name_prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = "northcentralus"
  dns_prefix          = "aks-${local.name_prefix}"

  sku_tier                  = "Free"
  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  default_node_pool {
    name                 = "system"
    node_count           = 1
    vm_size              = "Standard_D2pls_v6" # Arm64, 2 vCPU / 4 GiB; $0.062/h
    auto_scaling_enabled = false
    max_pods             = 30
    # AKS defaults to a 128 GiB Premium SSD (P10). 30 GiB is the documented
    # minimum and enough for the node image plus a handful of containers.
    os_disk_size_gb = 30

    # Declared explicitly so the provider does not try to remove the defaults
    # it reads back from the API on every plan (upgrade_settings drift).
    upgrade_settings {
      max_surge                     = "10%"
      drain_timeout_in_minutes      = 0
      node_soak_duration_in_minutes = 0
    }
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin    = "kubenet"
    load_balancer_sku = "standard"
  }

  tags = local.tags
}

# Workload Identity: Kubernetes issues a projected service-account token, Entra
# ID exchanges it for an Azure token. No client secret exists anywhere.
#
# The subject is fixed by the namespace and ServiceAccount name in k8s/:
#   system:serviceaccount:<namespace>:<serviceaccount>
resource "azurerm_federated_identity_credential" "aks_app" {
  name                      = "aks-azulab"
  user_assigned_identity_id = azurerm_user_assigned_identity.app.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = azurerm_kubernetes_cluster.main.oidc_issuer_url
  subject                   = "system:serviceaccount:azulab:azulab"
}
