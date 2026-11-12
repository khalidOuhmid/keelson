terraform {
  required_version = ">= 1.5"
}

variable "name" {
  type        = string
  description = "The sample's name."
  default     = "sample"
}

output "name" {
  value       = var.name
  description = "The sample's name."
}
