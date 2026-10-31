locals {
  operations = {
    list     = { route = "GET /files", actions = ["s3:ListBucket"], resources = [aws_s3_bucket.app["media"].arn] }
    start    = { route = "POST /uploads", actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.app["media"].arn}/*"] }
    parts    = { route = "POST /uploads/parts", actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.app["media"].arn}/*"] }
    complete = { route = "POST /uploads/complete", actions = ["s3:GetObject", "s3:PutObject", "s3:ListMultipartUploadParts", "s3:ListBucket"], resources = [aws_s3_bucket.app["media"].arn, "${aws_s3_bucket.app["media"].arn}/*"] }
    abort    = { route = "POST /uploads/abort", actions = ["s3:AbortMultipartUpload"], resources = ["${aws_s3_bucket.app["media"].arn}/*"] }
    stream   = { route = "POST /stream-links", actions = ["s3:GetObject", "s3:ListBucket"], resources = [aws_s3_bucket.app["media"].arn, "${aws_s3_bucket.app["media"].arn}/*"] }
  }
}
resource "aws_secretsmanager_secret" "ticket" {
  name                    = "${var.name}/upload-ticket"
  recovery_window_in_days = 7
}
resource "aws_secretsmanager_secret" "signing" {
  name                    = "${var.name}/cloudfront-private-key"
  recovery_window_in_days = 7
}
resource "aws_iam_role" "lambda" {
  for_each = local.operations
  name     = "${var.name}-${each.key}"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }
  ] })
}
resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.operations
  name              = "/aws/lambda/${var.name}-${each.key}"
  retention_in_days = 14
}
resource "aws_iam_role_policy" "lambda" {
  for_each = local.operations
  role     = aws_iam_role.lambda[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = each.value.actions, Resource = each.value.resources },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = each.key == "stream" ? aws_secretsmanager_secret.signing.arn : aws_secretsmanager_secret.ticket.arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.lambda[each.key].arn}:*" }
  ] })
}
data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/../back/dist/handler.cjs"
  output_path = "${path.module}/.build/api.zip"
}
resource "aws_lambda_function" "api" {
  for_each         = local.operations
  function_name    = "${var.name}-${each.key}"
  role             = aws_iam_role.lambda[each.key].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "handler.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size      = 256
  timeout          = 30
  environment {
    variables = {
      MEDIA_BUCKET       = aws_s3_bucket.app["media"].id
      MEDIA_DOMAIN       = aws_cloudfront_distribution.media.domain_name
      OPERATION          = each.key
      APP_ENV            = var.environment
      MAX_UPLOAD_BYTES   = tostring(var.max_upload_bytes)
      TICKET_SECRET_ARN  = aws_secretsmanager_secret.ticket.arn
      SIGNING_SECRET_ARN = aws_secretsmanager_secret.signing.arn
      CLOUDFRONT_KEY_ID  = aws_cloudfront_public_key.media.id
    }
  }
  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.lambda]
}
resource "aws_apigatewayv2_api" "app" {
  name          = var.name
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins  = local.origins
    allow_methods  = ["GET", "POST", "OPTIONS"]
    allow_headers  = ["authorization", "content-type"]
    expose_headers = ["x-request-id"]
    max_age        = 300
  }
}
resource "aws_apigatewayv2_authorizer" "owner" {
  api_id           = aws_apigatewayv2_api.app.id
  name             = "owner-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.owner.id}"
  }
}
resource "aws_apigatewayv2_integration" "lambda" {
  for_each               = local.operations
  api_id                 = aws_apigatewayv2_api.app.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api[each.key].invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "lambda" {
  for_each           = local.operations
  api_id             = aws_apigatewayv2_api.app.id
  route_key          = each.value.route
  target             = "integrations/${aws_apigatewayv2_integration.lambda[each.key].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.owner.id
}
resource "aws_lambda_permission" "api" {
  for_each      = local.operations
  statement_id  = "InvokeFromApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.app.execution_arn}/*/${split(" ", each.value.route)[0]}${split(" ", each.value.route)[1]}"
}
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = 14
}
resource "aws_apigatewayv2_stage" "app" {
  api_id      = aws_apigatewayv2_api.app.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format          = jsonencode({ requestId = "$context.requestId", route = "$context.routeKey", status = "$context.status", latency = "$context.responseLatency" })
  }
}
