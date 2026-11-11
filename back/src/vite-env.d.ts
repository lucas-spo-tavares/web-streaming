interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly OPERATION?: string;
  readonly AWS_REGION?: string;
  readonly MEDIA_BUCKET?: string;
  readonly RETENTION_TABLE?: string;
  readonly MEDIA_DOMAIN?: string;
  readonly TICKET_PARAMETER_ARN?: string;
  readonly SIGNING_PARAMETER_ARN?: string;
  readonly SHORT_LINK_PARAMETER_ARN?: string;
  readonly CLOUDFRONT_KEY_ID?: string;
  readonly APP_ENV?: string;
  readonly MAX_UPLOAD_BYTES?: string;
}
