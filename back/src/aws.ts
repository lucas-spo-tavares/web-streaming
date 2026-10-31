import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSignedUrl as signCloudFront } from '@aws-sdk/cloudfront-signer';
import { ApiError } from './core.js';
import { validateBackend, assertValid } from '../../config/environment.mjs';
import type { Storage, StoredPart, Dependencies } from './service.js';

const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });
const secrets = new SecretsManagerClient({});
const cached = new Map<string, { value: string; until: number }>();
export async function secretValue(arn: string) {
  const cachedValue = cached.get(arn);
  if (cachedValue && cachedValue.until > Date.now()) return cachedValue.value;
  const response = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!response.SecretString) throw new Error('Secret unavailable');
  cached.set(arn, { value: response.SecretString, until: Date.now() + 300000 });
  return response.SecretString;
}
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Configuration missing: ${name}`);
  return value;
}
export function awsDependencies(): Dependencies {
  assertValid(validateBackend(process.env));
  const Bucket = required('MEDIA_BUCKET');
  const storage: Storage = {
    async list(token) {
      const result = await s3.send(
        new ListObjectsV2Command({ Bucket, MaxKeys: 100, ContinuationToken: token }),
      );
      return {
        objects: (result.Contents ?? [])
          .filter((x) => x.Key && x.LastModified)
          .map((x) => ({ key: x.Key!, size: x.Size ?? 0, created: x.LastModified! })),
        token: result.NextContinuationToken,
      };
    },
    async head(Key) {
      try {
        const result = await s3.send(new HeadObjectCommand({ Bucket, Key }));
        if (!result.LastModified || result.ContentLength === undefined)
          throw new Error('Incomplete object metadata');
        return {
          key: Key,
          size: result.ContentLength,
          created: result.LastModified,
          metadata: result.Metadata,
        };
      } catch (e) {
        if (e instanceof Error && (e.name === 'NotFound' || e.name === 'NoSuchKey')) return null;
        throw e;
      }
    },
    async start(Key, ContentType, Metadata) {
      const result = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket,
          Key,
          ContentType,
          ContentDisposition: 'inline',
          Metadata,
        }),
      );
      if (!result.UploadId) throw new Error('Missing upload id');
      return result.UploadId;
    },
    async signPart(Key, UploadId, PartNumber, ContentLength) {
      return getSignedUrl(
        s3,
        new UploadPartCommand({ Bucket, Key, UploadId, PartNumber, ContentLength }),
        { expiresIn: 900 },
      );
    },
    async listParts(Key, UploadId) {
      const parts: StoredPart[] = [];
      let marker: string | undefined;
      do {
        const result = await s3.send(
          new ListPartsCommand({ Bucket, Key, UploadId, PartNumberMarker: marker }),
        );
        for (const p of result.Parts ?? []) {
          if (p.PartNumber && p.ETag && p.Size !== undefined)
            parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size });
        }
        marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
      } while (marker);
      return parts;
    },
    async complete(Key, UploadId, parts) {
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key,
          UploadId,
          MultipartUpload: {
            Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    },
    async abort(Key, UploadId) {
      try {
        await s3.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
      } catch (e) {
        if (!(e instanceof Error && e.name === 'NoSuchUpload')) throw e;
      }
    },
  };
  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 21474836480);
  return {
    storage,
    mediaDomain: process.env.MEDIA_DOMAIN ?? '',
    maxBytes,
    ticketSecret: async () => {
      const value = await secretValue(required('TICKET_SECRET_ARN'));
      if (Buffer.byteLength(value) < 32)
        throw new ApiError(503, 'CONFIGURATION', 'Serviço temporariamente indisponível.');
      return value;
    },
    signStream: async (url, expiry) =>
      signCloudFront({
        url,
        keyPairId: required('CLOUDFRONT_KEY_ID'),
        privateKey: await secretValue(required('SIGNING_SECRET_ARN')),
        dateLessThan: new Date(expiry).toISOString(),
      }),
  };
}
