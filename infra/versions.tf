terraform {
  required_version = ">= 1.11, < 2.0"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
}
provider "aws" {
  region = var.region
  default_tags {
    tags = { web-streaming = "true" }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { web-streaming = "true" }
  }
}
