variable "name" {
  type        = string
  description = "Nome curto usado para recursos, domínio Cognito e buckets globalmente únicos."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,29}$", var.name))
    error_message = "Use 3 a 30 caracteres minúsculos, números e hífens, iniciando com letra."
  }
}
variable "region" {
  type    = string
  default = "sa-east-1"
}
variable "environment" {
  type    = string
  default = "production"
  validation {
    condition     = contains(["production", "acceptance"], var.environment)
    error_message = "Use production ou acceptance."
  }
}
variable "signing_public_key_path" {
  type        = string
  description = "Caminho para a chave PÚBLICA PEM RSA 2048. Nunca fornecer a privada ao Terraform."
}
variable "local_front_origin" {
  type    = string
  default = "http://localhost:5173"
  validation {
    condition     = can(regex("^http://localhost:[0-9]+$", var.local_front_origin))
    error_message = "Origem local deve ser http://localhost:<porta>."
  }
}
variable "max_upload_bytes" {
  type        = number
  default     = 21474836480
  description = "Limite por arquivo, até 20 GiB, verificado antes da transferência."
  validation {
    condition     = var.max_upload_bytes >= 1 && var.max_upload_bytes <= 21474836480 && floor(var.max_upload_bytes) == var.max_upload_bytes
    error_message = "Use um número inteiro de bytes de 1 até 21474836480."
  }
}

variable "hosted_zone_name" {
  type        = string
  default     = "lucas-tavares.com"
  description = "Zona pública Route 53 existente, compartilhada com o portfolio."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.hosted_zone_name)) && !strcontains(var.hosted_zone_name, "..")
    error_message = "Informe o domínio da zona pública, sem protocolo nem ponto final."
  }
}

variable "frontend_domain_name" {
  type        = string
  default     = "streaming.lucas-tavares.com"
  description = "Subdomínio do front, com HTTPS pelo CloudFront."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.frontend_domain_name)) && !strcontains(var.frontend_domain_name, "..") && endswith(var.frontend_domain_name, ".${var.hosted_zone_name}")
    error_message = "Informe um subdomínio válido dentro de hosted_zone_name."
  }
}
