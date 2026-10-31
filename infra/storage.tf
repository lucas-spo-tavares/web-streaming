data "aws_caller_identity" "current" {}
locals {
  bucket_names = { media = "${var.name}-${data.aws_caller_identity.current.account_id}-media", front = "${var.name}-${data.aws_caller_identity.current.account_id}-front" }
  origins      = distinct(["https://${var.frontend_domain_name}", "https://${aws_cloudfront_distribution.front.domain_name}", var.local_front_origin])
}
resource "aws_s3_bucket" "app" {
  for_each      = local.bucket_names
  bucket        = each.value
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "app" {
  for_each                = local.bucket_names
  bucket                  = aws_s3_bucket.app[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "app" {
  for_each = local.bucket_names
  bucket   = aws_s3_bucket.app[each.key].id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  for_each = local.bucket_names
  bucket   = aws_s3_bucket.app[each.key].id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.app["media"].id
  rule {
    id     = "retention-30-days"
    status = "Enabled"
    filter {}
    expiration { days = 30 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.app["media"].id
  cors_rule {
    allowed_origins = local.origins
    allowed_methods = ["PUT"]
    allowed_headers = ["content-type", "x-amz-checksum-crc32", "x-amz-checksum-sha256", "x-amz-sdk-checksum-algorithm"]
    expose_headers  = ["ETag", "x-amz-checksum-crc32", "x-amz-checksum-sha256"]
    max_age_seconds = 900
  }
}
resource "aws_s3_bucket_policy" "app" {
  for_each = local.bucket_names
  bucket   = aws_s3_bucket.app[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "CloudFrontRead", Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject", Resource = "${aws_s3_bucket.app[each.key].arn}/*", Condition = { StringEquals = { "AWS:SourceArn" = each.key == "media" ? aws_cloudfront_distribution.media.arn : aws_cloudfront_distribution.front.arn } } },
    { Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.app[each.key].arn, "${aws_s3_bucket.app[each.key].arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
  depends_on = [aws_s3_bucket_public_access_block.app]
}
