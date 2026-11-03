locals {
  name_prefix = "${var.project}-${var.environment}"
  tags = {
    owner       = var.owner
    environment = var.environment
    project     = var.project
    managed_by  = "terraform"
    expires     = "2026-11-27"
  }
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 6
  lower   = true
  upper   = false
  numeric = true
  special = false
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name_prefix}-${var.location}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "law-${local.name_prefix}"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${local.name_prefix}"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  application_type    = "web"
  workspace_id        = azurerm_log_analytics_workspace.main.id
  tags                = local.tags
}

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-${local.name_prefix}"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = local.tags
}

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${local.name_prefix}-app"
  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_key_vault" "main" {
  name                       = "kv-${local.name_prefix}-${random_string.suffix.result}"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  # Azure does not allow changing this value after creation; 7 days is enough
  # for a lab and avoids reserving the vault name for 90 days after teardown.
  soft_delete_retention_days = 7
  tags                       = local.tags
}

# Terraform used to own the secret *value* here. That meant a secret lived in
# Git, which is exactly the pattern this project argues against. The value is
# now bootstrapped out-of-band (see docs/secret-lifecycle.md) and Terraform only
# stops managing it — `destroy = false` guarantees the secret is not deleted
# from Key Vault when the resource leaves the state.
removed {
  from = azurerm_key_vault_secret.app_message

  lifecycle {
    destroy = false
  }
}

resource "azurerm_storage_account" "main" {
  name                            = "st${var.project}${var.environment}${random_string.suffix.result}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  https_traffic_only_enabled      = true
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  # The app authenticates with its managed identity. Disabling shared-key auth
  # removes the account "master password" entirely: a leaked key is impossible
  # because no key exists.
  shared_access_key_enabled = false

  dynamic "network_rules" {
    for_each = length(var.allowed_storage_ip_ranges) > 0 ? [1] : []
    content {
      default_action = "Deny"
      ip_rules       = var.allowed_storage_ip_ranges
      bypass         = ["AzureServices"]
    }
  }

  # Data protection. Versioning keeps every overwrite of current_message.txt;
  # soft delete makes an accidental DELETE recoverable for 7 days.
  blob_properties {
    versioning_enabled  = true
    change_feed_enabled = true

    delete_retention_policy {
      days = 7
    }

    container_delete_retention_policy {
      days = 7
    }
  }

  tags = local.tags
}

resource "azurerm_storage_container" "demo" {
  name                  = "demo"
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}

# Grant the deploying principal Key Vault Administrator so it can create the secret.
resource "azurerm_role_assignment" "kv_admin" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "app_kv_secrets_user" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_role_assignment" "app_blob_contributor" {
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_container_app" "app" {
  name                         = "ca-${local.name_prefix}"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  template {
    min_replicas = 0
    max_replicas = 2

    container {
      name   = var.project
      image  = var.image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "KEY_VAULT_URL"
        value = azurerm_key_vault.main.vault_uri
      }
      env {
        name  = "SECRET_NAME"
        value = "app-message"
      }
      env {
        name  = "STORAGE_ACCOUNT_URL"
        value = "https://${azurerm_storage_account.main.name}.blob.core.windows.net"
      }
      env {
        name  = "CONTAINER_NAME"
        value = "demo"
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/health"
      }

      readiness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/ready"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  tags = local.tags

  lifecycle {
    # The CD pipeline owns the running image; Terraform owns everything else.
    # Without this, every `terraform plan` after a deploy proposes a downgrade
    # to whatever tag happens to sit in variables or tfvars.
    ignore_changes = [template[0].container[0].image]
  }
}

# --- Observability ---------------------------------------------------------
# Without diagnostic settings the resources are blind spots: a failed Key Vault
# access or a denied blob request leaves no trace. Logs land in the workspace
# that Container Apps already uses, so there is a single place to query.

resource "azurerm_monitor_diagnostic_setting" "key_vault" {
  name                       = "diag-${local.name_prefix}-kv"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category_group = "allLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

# AKS control-plane audit. kube-audit-admin records mutating requests only:
# the useful signal (who created/deleted what) without the cost and noise of
# logging every read. Workload logs already reach the same workspace through
# the Container Apps environment; node-level Container Insights is a documented
# next step, not a prerequisite for the audit trail.
resource "azurerm_monitor_diagnostic_setting" "aks" {
  name                       = "diag-${local.name_prefix}-aks"
  target_resource_id         = azurerm_kubernetes_cluster.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "kube-audit-admin"
  }

  enabled_log {
    category = "cluster-autoscaler"
  }
}

# Storage diagnostics attach to the blob service, not to the account: account
# level settings do not capture data-plane operations.
# StorageRead is deliberately omitted — every message read would be logged and
# the volume adds cost without adding signal for this lab.
resource "azurerm_monitor_diagnostic_setting" "storage_blob" {
  name                       = "diag-${local.name_prefix}-blob"
  target_resource_id         = "${azurerm_storage_account.main.id}/blobServices/default"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "StorageWrite"
  }

  enabled_log {
    category = "StorageDelete"
  }
}
