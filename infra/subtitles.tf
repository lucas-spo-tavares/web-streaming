data "archive_file" "subtitles" {
  type        = "zip"
  source_file = "${path.module}/../subtitles/handler.py"
  output_path = "${path.module}/.build/subtitles-handler.zip"
}

resource "aws_lambda_layer_version" "ffmpeg" {
  layer_name               = "${var.name}-ffmpeg"
  filename                 = "${path.module}/.build/subtitles/ffmpeg-layer.zip"
  source_code_hash         = filebase64sha256("${path.module}/.build/subtitles/ffmpeg-layer.zip")
  compatible_runtimes      = ["python3.13"]
  compatible_architectures = ["x86_64"]
  description              = "FFmpeg/FFprobe 8.1.3: text subtitle extraction, built on Amazon Linux 2023"
}

resource "aws_iam_role" "subtitles" {
  name = "${var.name}-subtitle-extract"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }
  ] })
}
resource "aws_cloudwatch_log_group" "subtitles" {
  name              = "/aws/lambda/${var.name}-subtitle-extract"
  retention_in_days = 14
}
resource "aws_iam_role_policy" "subtitles" {
  role = aws_iam_role.subtitles.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.app["media"].arn}/*" },
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.app["media"].arn },
    { Effect = "Allow", Action = ["s3:PutObject", "s3:DeleteObject"], Resource = ["${aws_s3_bucket.app["media"].arn}/*/tracks.json", "${aws_s3_bucket.app["media"].arn}/*/*.srt", "${aws_s3_bucket.app["media"].arn}/*/*.vtt"] },
    { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.retention.arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.subtitles.arn}:*" }
  ] })
}
resource "aws_lambda_function" "subtitles" {
  function_name    = "${var.name}-subtitle-extract"
  role             = aws_iam_role.subtitles.arn
  runtime          = "python3.13"
  architectures    = ["x86_64"]
  handler          = "handler.handler"
  filename         = data.archive_file.subtitles.output_path
  source_code_hash = data.archive_file.subtitles.output_base64sha256
  layers           = [aws_lambda_layer_version.ffmpeg.arn]
  memory_size      = 1024
  timeout          = 900
  environment {
    variables = {
      MEDIA_BUCKET    = aws_s3_bucket.app["media"].id
      RETENTION_TABLE = aws_dynamodb_table.retention.name
    }
  }
  depends_on = [aws_iam_role_policy.subtitles, aws_cloudwatch_log_group.subtitles]
}
resource "aws_lambda_permission" "subtitles" {
  statement_id   = "ExtractUploadedSubtitles"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.subtitles.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.app["media"].arn
  source_account = data.aws_caller_identity.current.account_id
}
resource "aws_s3_bucket_notification" "subtitles" {
  bucket = aws_s3_bucket.app["media"].id
  lambda_function {
    lambda_function_arn = aws_lambda_function.subtitles.arn
    events              = ["s3:ObjectCreated:CompleteMultipartUpload"]
  }
  depends_on = [aws_lambda_permission.subtitles]
}
resource "aws_lambda_function_event_invoke_config" "subtitles" {
  function_name                = aws_lambda_function.subtitles.function_name
  maximum_event_age_in_seconds = 900
  maximum_retry_attempts       = 1
}
