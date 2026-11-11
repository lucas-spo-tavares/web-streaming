import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { getSignedUrl as signCloudFront } from '@aws-sdk/cloudfront-signer';
import { ApiError } from '@/core';
import { shortenLink } from '@/short-links';
import { assertValid, validateBackend } from '../../config/environment.ts';
import { config, required } from '@/config';
import { MAX_BYTES } from '@/contracts';

const secrets = new SSMClient({ region: config.AWS_REGION });
const cached = new Map<string, { value: string; until: number }>();

export async function secretValue(arn: string) {
  const cachedValue = cached.get(arn);

  if (cachedValue && cachedValue.until > Date.now()) return cachedValue.value;

  const response = await secrets.send(new GetParameterCommand({ Name: arn, WithDecryption: true }));
  const value = response.Parameter?.Value;

  if (
    response.Parameter?.Type !== 'SecureString' ||
    !value ||
    value === 'PENDING_SECRET_INITIALIZATION'
  )
    throw new Error('Secret unavailable');
  cached.set(arn, { value, until: Date.now() + 300000 });

  return value;
}

export function validateConfiguration() {
  assertValid(validateBackend(config));
}

export async function shorten(url: string, expiresAt: string, code?: string) {
  return shortenLink(url, await secretValue(required('SHORT_LINK_PARAMETER_ARN')), {
    expiresAt,
    code,
  });
}

export function mediaDomain() {
  return config.MEDIA_DOMAIN ?? '';
}

export function maxBytes() {
  return Number(config.MAX_UPLOAD_BYTES ?? MAX_BYTES);
}

export async function ticketSecret() {
  const value = await secretValue(required('TICKET_PARAMETER_ARN'));

  if (Buffer.byteLength(value) < 32)
    throw new ApiError(503, 'CONFIGURATION', 'Serviço temporariamente indisponível.');

  return value;
}

export async function signStream(url: string, expiry: number) {
  return signCloudFront({
    url,
    keyPairId: required('CLOUDFRONT_KEY_ID'),
    privateKey: await secretValue(required('SIGNING_PARAMETER_ARN')),
    dateLessThan: new Date(expiry).toISOString(),
  });
}
