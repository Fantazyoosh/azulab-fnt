output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "container_app_name" {
  value = azurerm_container_app.app.name
}

output "container_app_url" {
  value = "https://${azurerm_container_app.app.ingress[0].fqdn}"
}

output "key_vault_name" {
  value = azurerm_key_vault.main.name
}

output "key_vault_uri" {
  value = azurerm_key_vault.main.vault_uri
}

output "storage_account_name" {
  value = azurerm_storage_account.main.name
}

output "user_assigned_identity_client_id" {
  value = azurerm_user_assigned_identity.app.client_id
}

output "log_analytics_workspace_id" {
  value = azurerm_log_analytics_workspace.main.id
}

output "aks_cluster_name" {
  value = azurerm_kubernetes_cluster.main.name
}

output "aks_location" {
  value = azurerm_kubernetes_cluster.main.location
}

output "aks_oidc_issuer_url" {
  value = azurerm_kubernetes_cluster.main.oidc_issuer_url
}

output "aks_kubelet_identity_object_id" {
  value = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}
