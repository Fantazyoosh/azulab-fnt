variable "project" {
  type        = string
  default     = "azulab"
  description = "Project short name used in resource names."
}

variable "environment" {
  type        = string
  default     = "dev"
  description = "Environment name (dev/stage/prod)."
}

variable "location" {
  type        = string
  default     = "polandcentral"
  description = "Azure region for all resources."
}

variable "image" {
  type        = string
  default     = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
  description = "Container image to deploy (overridden by CI/CD with a ghcr.io tag)."
}

variable "budget_alert_email" {
  type        = string
  default     = ""
  description = "Email for the subscription budget alert. Empty disables the budget resource."
}

variable "allowed_storage_ip_ranges" {
  type        = list(string)
  default     = []
  description = "Optional allow-list for the storage account network rules. Country-based blocking is documented in docs/06-security.md."
}

variable "owner" {
  type    = string
  default = "maciej"
}
