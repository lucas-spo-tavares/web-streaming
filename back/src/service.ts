import { randomUUID } from 'node:crypto';
import {
  shorten,
  mediaDomain,
  maxBytes as uploadMaxBytes,
  ticketSecret,
  signStream,
} from './aws.js';
import * as s3Repository from './repository/s3.js';
import * as dynamoRepository from './repository/dynamo.js';
import {
  abortSchema,
  completeSchema,
  deleteSchema,
  renewSchema,
  downloadSchema,
  keySchema,
  listSchema,
  PART_BYTES,
  partsSchema,
  RETENTION_MS,
  startSchema,
  streamSchema,
} from './contracts.js';
import {
  ApiError,
  encodeKey,
  fileInfo,
  invalid,
  linkExpiry,
  missing,
  readCursor,
  readUpload,
  seal,
  type UploadTicket,
} from './core.js';

export interface StoredObject {
  key: string;
  size: number;
  created: Date;
  metadata?: Record<string, string>;
  expires?: Date;
  deleting?: boolean;
}
export interface StoredPart {
  partNumber: number;
  size: number;
  etag: string;
}
function info(object: StoredObject, serverNow = Date.now()) {
  return fileInfo(object.key, object.size, object.created, serverNow, RETENTION_MS, object.expires);
}

async function ticket(value: string, sub: string) {
  return readUpload(value, await ticketSecret(), sub, Date.now());
}

async function existing(t: UploadTicket) {
  const object = await s3Repository.head(t.key);
  if (!object) return null;
  if (
    object.size !== t.size ||
    object.metadata?.['session-id'] !== t.nonce ||
    object.metadata?.['owner-id'] !== t.sub
  ) {
    throw new ApiError(409, 'UPLOAD_CONFLICT', 'O arquivo não corresponde à sessão de upload.');
  }
  return object;
}

export async function stream(input: unknown) {
  const { key } = streamSchema.parse(input);
  const object = await s3Repository.head(key);
  if (!object || object.deleting) throw missing();
  const serverNow = Date.now();
  const expiry = linkExpiry(object.created, serverNow, RETENTION_MS, object.expires);
  return {
    url: await signStream(`https://${mediaDomain()}/${encodeKey(key)}`, expiry),
    expiresAt: new Date(expiry).toISOString(),
    serverNow: new Date(serverNow).toISOString(),
  };
}

export async function list(input: unknown, sub: string) {
  const { q: query, cursor } = listSchema.parse(input);
  const q = query.trim().toLowerCase();
  const secret = await ticketSecret();
  const token = cursor ? readCursor(cursor, secret, sub, q, Date.now()) : undefined;
  const page = await s3Repository.list(token);
  const serverNow = Date.now();
  return {
    files: page.objects
      .filter((o) => !o.deleting && keySchema.safeParse(o.key).success)
      .map((o) => info(o, serverNow))
      .filter((f) => f.name.toLowerCase().includes(q)),
    nextCursor: page.token
      ? seal({ kind: 'cursor', sub, q, token: page.token, exp: serverNow + 3600000 }, secret)
      : null,
    serverNow: new Date(serverNow).toISOString(),
  };
}

export async function start(input: unknown, sub: string) {
  const maxBytes = uploadMaxBytes();

  const data = startSchema.parse(input);
  if (data.size > maxBytes)
    throw new ApiError(413, 'FILE_TOO_LARGE', 'Arquivo excede o limite de upload.');
  const secret = await ticketSecret();
  const key = `${randomUUID()}--${data.name}`;
  const nonce = randomUUID();
  const uploadId = await s3Repository.start(key, data.contentType, {
    'session-id': nonce,
    'owner-id': sub,
  });
  const payload: UploadTicket = {
    kind: 'upload',
    sub,
    key,
    nonce,
    uploadId,
    size: data.size,
    partSize: PART_BYTES,
    exp: Date.now() + 24 * 3600000,
  };
  return {
    ticket: seal(payload, secret),
    partSize: PART_BYTES,
    partCount: Math.ceil(data.size / PART_BYTES),
    maxBytes,
  };
}

export async function parts(input: unknown, sub: string) {
  const data = partsSchema.parse(input);
  const t = await ticket(data.ticket, sub);
  const count = Math.ceil(t.size / t.partSize);
  if (
    new Set(data.partNumbers).size !== data.partNumbers.length ||
    data.partNumbers.some((n) => n > count)
  )
    throw invalid();
  return {
    parts: await Promise.all(
      data.partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await s3Repository.signPart(
          t.key,
          t.uploadId,
          partNumber,
          Math.min(t.partSize, t.size - (partNumber - 1) * t.partSize),
        ),
      })),
    ),
  };
}

export async function complete(input: unknown, sub: string) {
  const data = completeSchema.parse(input);
  const t = await ticket(data.ticket, sub);
  const already = await existing(t);
  if (already) return { file: info(already) };
  const count = Math.ceil(t.size / t.partSize);
  if (data.parts.length !== count) throw invalid();
  const parts = [...data.parts].sort((a, b) => a.partNumber - b.partNumber);
  if (parts.some((p, i) => p.partNumber !== i + 1)) throw invalid();
  const actual = await s3Repository.listParts(t.key, t.uploadId);
  if (
    actual.length !== count ||
    parts.some((p, i) => {
      const a = actual.find((x) => x.partNumber === p.partNumber);
      return !a || a.etag !== p.etag || a.size !== Math.min(t.partSize, t.size - i * t.partSize);
    })
  )
    throw new ApiError(
      409,
      'PARTS_MISMATCH',
      'Partes incompletas ou inconsistentes. Repita as partes com falha.',
    );
  await s3Repository.complete(t.key, t.uploadId, parts);
  const object = await existing(t);
  if (!object)
    throw new ApiError(
      503,
      'UPLOAD_UNCONFIRMED',
      'Não foi possível confirmar o envio. Tente concluir novamente.',
    );
  return { file: info(object) };
}

export async function abort(input: unknown, sub: string) {
  const data = abortSchema.parse(input);
  const t = await ticket(data.ticket, sub);
  await s3Repository.abort(t.key, t.uploadId);
  return { aborted: true };
}

export async function deleteFile(input: unknown) {
  const { key } = deleteSchema.parse(input);
  await s3Repository.deleteFile(key);
  return { deleted: true };
}

export async function renew(input: unknown) {
  const { key } = renewSchema.parse(input);
  const object = await s3Repository.head(key);
  if (!object || object.deleting) throw missing();
  const serverNow = Date.now();
  const expires = new Date(serverNow + RETENTION_MS);
  if (!(await dynamoRepository.renew(key, expires)))
    throw new ApiError(409, 'DELETION_STARTED', 'A exclusão deste arquivo já começou.');
  return {
    file: info({ ...object, expires }, serverNow),
    serverNow: new Date(serverNow).toISOString(),
  };
}

export async function download(input: unknown) {
  const { key } = downloadSchema.parse(input);
  const object = await s3Repository.head(key);
  if (!object || object.deleting) throw missing();
  const serverNow = Date.now();
  const expiry = Math.min(
    linkExpiry(object.created, serverNow, RETENTION_MS, object.expires),
    serverNow + 15 * 60000,
  );
  return {
    url: await s3Repository.signDownload(key, key.slice(38), expiry),
    expiresAt: new Date(expiry).toISOString(),
    serverNow: new Date(serverNow).toISOString(),
  };
}

export async function short(input: unknown) {
  const result = await stream(input);
  return { ...result, url: await shorten(result.url) };
}

export async function expireFiles() {
  let token: string | undefined;
  let deleted = 0;
  do {
    const page = await s3Repository.list(token);
    for (const object of page.objects) {
      if (!keySchema.safeParse(object.key).success) continue;
      const timestamp = Date.now();
      if (
        !object.deleting &&
        (object.expires?.getTime() ?? object.created.getTime() + RETENTION_MS) > timestamp
      )
        continue;
      if (await s3Repository.deleteExpired(object.key, timestamp)) deleted++;
    }
    token = page.token;
  } while (token);
  return { deleted };
}
