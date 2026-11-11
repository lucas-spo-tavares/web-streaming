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
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as retention from '@/repository/dynamo';
import { config, required } from '@/config';
import type { StoredObject, StoredPart } from '@/service';
import { keySchema } from '@/contracts';

const s3 = new S3Client({ region: config.AWS_REGION, requestChecksumCalculation: 'WHEN_REQUIRED' });

export async function findVideo(uuid: string) {
  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: required('MEDIA_BUCKET'),
      Prefix: uuid + '/',
      MaxKeys: 100,
    }),
  );
  const videos = (result.Contents ?? []).filter(
    (item) => item.Key && keySchema.safeParse(item.Key).success,
  );
  if (result.IsTruncated || videos.length > 1) throw new Error('Invalid video folder');
  return videos[0]?.Key ? head(videos[0].Key) : null;
}

export async function readText(Key: string, limit = 2 * 1024 * 1024): Promise<string | null> {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: required('MEDIA_BUCKET'), Key }));
    if (!result.Body || result.ContentLength === undefined || result.ContentLength > limit) {
      await result.Body?.transformToWebStream().cancel();
      throw new Error('Subtitle object exceeds limit');
    }
    return result.Body.transformToString('utf-8');
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchKey') return null;
    throw error;
  }
}

export async function deleteExpired(Key: string, now: number) {
  if (!(await retention.claimDeletion(Key, now))) return false;
  await deleteFolder(Key);
  return true;
}
export async function deleteFile(Key: string) {
  await retention.claimDeletion(Key);
  await deleteFolder(Key);
}
async function deleteFolder(key: string) {
  keySchema.parse(key);
  const Bucket = required('MEDIA_BUCKET');
  const Prefix = `${key.split('/')[0]}/`;
  // Keep the video until its siblings are gone, so cleanup can discover and retry a failed deletion.
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: token }),
    );
    const Objects = (page.Contents ?? [])
      .filter((item) => item.Key && item.Key !== key)
      .map((item) => ({ Key: item.Key! }));
    if (Objects.length) {
      const result = await s3.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: true } }),
      );
      if (result.Errors?.length) throw new Error('Folder deletion incomplete');
    }
    token = page.NextContinuationToken;
  } while (token);
  await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
}
export async function list(token?: string) {
  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: required('MEDIA_BUCKET'),
      MaxKeys: 100,
      ContinuationToken: token,
    }),
  );
  const objects = (result.Contents ?? []).filter(
    (x) => x.Key && x.LastModified && keySchema.safeParse(x.Key).success,
  );
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
