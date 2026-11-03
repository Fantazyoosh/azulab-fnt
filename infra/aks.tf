# AKS — the Kubernetes runtime for the Azulab demo.
#
# Why a separate region:
#   This subscription is an Azure Free Trial (quotaId FreeTrial_2014-09-01).
#   Compute SKU availability is restricted per region, and polandcentral only
#   exposes HPC/GPU sizes to this offer. swedencentral is the closest region
#   where Standard_D2as_v5 is actually allowed (verified against
#   Microsoft.Compute/skus restrictions). The resource group stays in
#   polandcentral — a resource group is a logical container, not a location
#   constraint for the resources inside it.
#
# Deliberate trade-offs:
#   * Free tier control plane -> no SLA, zero control-plane cost (lab budget).
#   * One node                 -> no node-level HA; pod-level HA via 2 replicas.
#   * kubenet                  -> no VNet/subnet design needed for a lab.
#                                 Production would use Azure CNI Overlay.
#   * Public API server        -> private cluster costs more and complicates
#                                 the demo; documented as a next step.

resource "azurerm_kubernetes_cluster" "main" {
  name                = "aks-${local.name_prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = "swedencentral"
  dns_prefix          = "aks-${local.name_prefix}"

  sku_tier                  = "Free"
  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  default_node_pool {
    name                 = "system"
    node_count           = 1
    vm_size              = "Standard_D2as_v5" # 2 vCPU / 8 GiB; 4 vCPU quota available
    auto_scaling_enabled = false
    max_pods             = 30

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
