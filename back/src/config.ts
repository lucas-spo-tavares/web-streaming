export const config = {
  get OPERATION() {
    return import.meta.env.OPERATION;
  },
  get AWS_REGION() {
    return import.meta.env.AWS_REGION;
  },
  get MEDIA_BUCKET() {
    return import.meta.env.MEDIA_BUCKET;
  },
  get RETENTION_TABLE() {
    return import.meta.env.RETENTION_TABLE;
  },
  get MEDIA_DOMAIN() {
    return import.meta.env.MEDIA_DOMAIN;
  },
  get TICKET_PARAMETER_ARN() {
    return import.meta.env.TICKET_PARAMETER_ARN;
  },
  get SIGNING_PARAMETER_ARN() {
    return import.meta.env.SIGNING_PARAMETER_ARN;
  },
  get SHORT_LINK_PARAMETER_ARN() {
    return import.meta.env.SHORT_LINK_PARAMETER_ARN;
  },
  get CLOUDFRONT_KEY_ID() {
    return import.meta.env.CLOUDFRONT_KEY_ID;
  },
  get APP_ENV() {
    return import.meta.env.APP_ENV;
  },
  get MAX_UPLOAD_BYTES() {
    return import.meta.env.MAX_UPLOAD_BYTES;
  },
};

export type AppConfig = typeof config;

export function required(name: keyof AppConfig) {
  const value = config[name];
  if (!value) throw new Error(`Configuration missing: ${name}`);
  return value;
}
