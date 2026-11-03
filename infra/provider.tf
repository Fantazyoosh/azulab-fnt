provider "azurerm" {
  features {}

  # The storage account has shared-key authentication disabled, so the provider
  # cannot read queue/blob service properties with an account key. This makes
  # the provider authenticate with Entra ID instead — the same model the
  # application uses.
  storage_use_azuread = true
}
