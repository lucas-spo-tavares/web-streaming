resource "aws_cloudfront_origin_access_control" "app" {
  for_each                          = local.bucket_names
  name                              = "${var.name}-${each.key}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_public_key" "media" {
  name        = "${var.name}-media"
  encoded_key = file(var.signing_public_key_path)
}
resource "aws_cloudfront_key_group" "media" {
  name  = "${var.name}-media"
  items = [aws_cloudfront_public_key.media.id]
}
resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name} private media"
  price_class     = "PriceClass_All"
  origin {
    domain_name              = aws_s3_bucket.app["media"].bucket_regional_domain_name
    origin_id                = "media"
    origin_access_control_id = aws_cloudfront_origin_access_control.app["media"].id
  }
  default_cache_behavior {
    target_origin_id       = "media"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false
    trusted_key_groups     = [aws_cloudfront_key_group.media.id]
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 86400
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}
resource "aws_cloudfront_distribution" "front" {
  aliases             = [var.frontend_domain_name]
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${var.name} web application"
  origin {
    domain_name              = aws_s3_bucket.app["front"].bucket_regional_domain_name
    origin_id                = "front"
    origin_access_control_id = aws_cloudfront_origin_access_control.app["front"].id
  }
  default_cache_behavior {
    target_origin_id       = "front"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    min_ttl                = 0
    default_ttl            = 300
    max_ttl                = 86400
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }
  dynamic "custom_error_response" {
    for_each = [403, 404]
    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.front.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
