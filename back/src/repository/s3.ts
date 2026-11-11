import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as retention from '@/repository/dynamo';
import { config, required } from '@/config';
import type { StoredObject, StoredPart } from '@/service';

const s3 = new S3Client({ region: config.AWS_REGION, requestChecksumCalculation: 'WHEN_REQUIRED' });

export async function deleteExpired(Key: string, now: number) {
  if (!(await retention.claimDeletion(Key, now))) return false;
  await s3.send(new DeleteObjectCommand({ Bucket: required('MEDIA_BUCKET'), Key }));
  return true;
}
export async function deleteFile(Key: string) {
  await retention.claimDeletion(Key);
  await s3.send(new DeleteObjectCommand({ Bucket: required('MEDIA_BUCKET'), Key }));
}
export async function list(token?: string) {
  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: required('MEDIA_BUCKET'),
      MaxKeys: 100,
      ContinuationToken: token,
    }),
  );
  const objects = (result.Contents ?? []).filter((x) => x.Key && x.LastModified);
  const records = await retention.batch(objects.map((x) => x.Key!));
  return {
    objects: objects.map((x) => ({
      key: x.Key!,
      size: x.Size ?? 0,
      created: x.LastModified!,
      ...records.get(x.Key!),
    })),
    token: result.NextContinuationToken,
  };
}
export async function head(Key: string): Promise<StoredObject | null> {
  try {
    const result = await s3.send(new HeadObjectCommand({ Bucket: required('MEDIA_BUCKET'), Key }));
    if (!result.LastModified || result.ContentLength === undefined)
      throw new Error('Incomplete object metadata');
    return {
      key: Key,
      size: result.ContentLength,
      created: result.LastModified,
      metadata: result.Metadata,
      ...(await retention.get(Key)),
    };
  } catch (e) {
    if (e instanceof Error && (e.name === 'NotFound' || e.name === 'NoSuchKey')) return null;
    throw e;
  }
}
export async function start(Key: string, ContentType: string, Metadata: Record<string, string>) {
  const result = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: required('MEDIA_BUCKET'),
      Key,
      ContentType,
      ContentDisposition: 'inline',
      Metadata,
    }),
  );
  if (!result.UploadId) throw new Error('Missing upload id');
  return result.UploadId;
}
export async function signPart(
  Key: string,
  UploadId: string,
  PartNumber: number,
  ContentLength: number,
) {
  return getSignedUrl(
    s3,
    new UploadPartCommand({
      Bucket: required('MEDIA_BUCKET'),
      Key,
      UploadId,
      PartNumber,
      ContentLength,
    }),
    { expiresIn: 900 },
  );
}
export async function listParts(Key: string, UploadId: string) {
  const parts: StoredPart[] = [];
  let marker: string | undefined;
  do {
    const result = await s3.send(
      new ListPartsCommand({
        Bucket: required('MEDIA_BUCKET'),
        Key,
        UploadId,
        PartNumberMarker: marker,
      }),
    );
    for (const p of result.Parts ?? []) {
      if (p.PartNumber && p.ETag && p.Size !== undefined)
        parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size });
    }
    marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
}
export async function complete(
  Key: string,
  UploadId: string,
  parts: { partNumber: number; etag: string }[],
) {
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: required('MEDIA_BUCKET'),
      Key,
      UploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }),
  );
}
export async function abort(Key: string, UploadId: string) {
  try {
    await s3.send(
      new AbortMultipartUploadCommand({ Bucket: required('MEDIA_BUCKET'), Key, UploadId }),
    );
  } catch (e) {
    if (!(e instanceof Error && e.name === 'NoSuchUpload')) throw e;
  }
}

export async function signDownload(Key: string, name: string, expiry: number) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: required('MEDIA_BUCKET'),
      Key,
      ResponseContentDisposition: `attachment; filename="video"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase())}`,
      ResponseContentType: 'application/octet-stream',
    }),
    { expiresIn: Math.max(1, Math.floor((expiry - Date.now()) / 1000)) },
  );
}
