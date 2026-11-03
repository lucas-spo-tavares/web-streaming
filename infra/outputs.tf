output "frontend_url" { value = "https://${var.frontend_domain_name}" }
output "frontend_cloudfront_url" { value = "https://${aws_cloudfront_distribution.front.domain_name}" }
output "frontend_bucket" { value = aws_s3_bucket.app["front"].id }
output "media_bucket" { value = aws_s3_bucket.app["media"].id }
output "media_domain" { value = aws_cloudfront_distribution.media.domain_name }
output "front_distribution_id" { value = aws_cloudfront_distribution.front.id }
output "user_pool_id" { value = aws_cognito_user_pool.owner.id }
output "ticket_parameter_arn" { value = aws_ssm_parameter.ticket.arn }
output "signing_parameter_arn" { value = aws_ssm_parameter.signing.arn }
output "frontend_config" {
  value = {
    VITE_API_URL    = aws_apigatewayv2_api.app.api_endpoint
    VITE_AWS_REGION = var.region
    VITE_CLIENT_ID  = aws_cognito_user_pool_client.web.id
  }
}
