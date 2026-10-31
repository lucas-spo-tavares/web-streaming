resource "aws_cognito_user_pool" "owner" {
  name                     = var.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  user_pool_tier           = "ESSENTIALS"
  deletion_protection      = "ACTIVE"
  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD", "EMAIL_OTP"]
  }
  admin_create_user_config { allow_admin_create_user_only = true }
  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}
resource "aws_cognito_user_group" "owners" {
  name         = "owners"
  user_pool_id = aws_cognito_user_pool.owner.id
}
resource "aws_cognito_resource_server" "api" {
  identifier   = "${var.name}-api"
  name         = "Acervo API"
  user_pool_id = aws_cognito_user_pool.owner.id
  scope {
    scope_name        = "manage"
    scope_description = "Manage personal video library"
  }
}
resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${var.name}-web"
  user_pool_id                         = aws_cognito_user_pool.owner.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "${aws_cognito_resource_server.api.identifier}/manage"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = [for origin in local.origins : "${origin}/callback"]
  logout_urls                          = [for origin in local.origins : origin]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 15
  id_token_validity                    = 15
  auth_session_validity                = 3
  refresh_token_validity               = 1
  explicit_auth_flows                  = ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
resource "aws_cognito_user_pool_domain" "owner" {
  domain                = "${var.name}-${data.aws_caller_identity.current.account_id}"
  user_pool_id          = aws_cognito_user_pool.owner.id
  managed_login_version = 2
}
resource "aws_cognito_managed_login_branding" "web" {
  client_id                   = aws_cognito_user_pool_client.web.id
  user_pool_id                = aws_cognito_user_pool.owner.id
  use_cognito_provided_values = true
  depends_on                  = [aws_cognito_user_pool_domain.owner]
}
