data "aws_route53_zone" "app" {
  name         = var.hosted_zone_name
  private_zone = false
}

# CloudFront requires its viewer certificate in us-east-1.
resource "aws_acm_certificate" "front" {
  provider          = aws.us_east_1
  domain_name       = var.frontend_domain_name
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "certificate" {
  for_each = {
    for option in aws_acm_certificate.front.domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      type   = option.resource_record_type
      record = option.resource_record_value
    }
  }
  zone_id = data.aws_route53_zone.app.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "front" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.front.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate : record.fqdn]
}

resource "aws_route53_record" "front" {
  for_each = toset(["A", "AAAA"])
  zone_id  = data.aws_route53_zone.app.zone_id
  name     = var.frontend_domain_name
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.front.domain_name
    zone_id                = aws_cloudfront_distribution.front.hosted_zone_id
    evaluate_target_health = false
  }
}
