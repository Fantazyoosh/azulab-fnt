terraform {
  # Remote state.
  #
  # The storage account below is created outside Terraform on purpose: it must
  # exist before `terraform init`, so it cannot be managed by the configuration
  # whose state it stores. It has shared key auth disabled and no public blob
  # access; access is Entra ID only (`use_azuread_auth = true`).
  #
  # Bootstrap (documented in docs/runbook.md):
  #   az storage account create -n stazulabtfstate6mvarl -g rg-azulab-dev-polandcentral \
  #     -l polandcentral --sku Standard_LRS --allow-shared-key-access false \
  #     --allow-blob-public-access false --https-only true --min-tls-version TLS1_2
  #   az storage container create -n tfstate --account-name stazulabtfstate6mvarl \
  #     --auth-mode login
  backend "azurerm" {
    resource_group_name  = "rg-azulab-dev-polandcentral"
    storage_account_name = "stazulabtfstate6mvarl"
    container_name       = "tfstate"
    key                  = "azulab.tfstate"
    use_azuread_auth     = true
  }
}
