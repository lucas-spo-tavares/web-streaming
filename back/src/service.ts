import { randomUUID } from 'node:crypto';
import {
  abortSchema,
  completeSchema,
  keySchema,
  listSchema,
  MAX_BYTES,
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
}
export interface StoredPart {
  partNumber: number;
  size: number;
  etag: string;
}
export interface Storage {
  list(token?: string): Promise<{ objects: StoredObject[]; token?: string }>;
  head(key: string): Promise<StoredObject | null>;
  start(key: string, contentType: string, metadata: Record<string, string>): Promise<string>;
  signPart(key: string, uploadId: string, partNumber: number, size: number): Promise<string>;
  listParts(key: string, uploadId: string): Promise<StoredPart[]>;
  complete(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void>;
  abort(key: string, uploadId: string): Promise<void>;
}
export interface Dependencies {
  storage: Storage;
  ticketSecret(): Promise<string>;
  signStream(url: string, expires: number): Promise<string>;
  mediaDomain: string;
  now?: () => number;
  maxBytes?: number;
  retentionMs?: number;
}
export function createService(d: Dependencies) {
  const now = d.now ?? Date.now;
  const maxBytes = d.maxBytes ?? MAX_BYTES;
  const retention = d.retentionMs ?? RETENTION_MS;
  async function ticket(value: string, sub: string) {
    return readUpload(value, await d.ticketSecret(), sub, now());
  }
  async function existing(t: UploadTicket) {
    const object = await d.storage.head(t.key);
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
  return {
    async list(input: unknown, sub: string) {
      const { q: query, cursor } = listSchema.parse(input);
      const q = query.trim().toLowerCase();
      const secret = await d.ticketSecret();
      const token = cursor ? readCursor(cursor, secret, sub, q, now()) : undefined;
      const page = await d.storage.list(token);
      const serverNow = now();
      return {
        files: page.objects
          .filter((o) => keySchema.safeParse(o.key).success)
          .map((o) => fileInfo(o.key, o.size, o.created, serverNow, retention))
          .filter((f) => f.name.toLowerCase().includes(q)),
        nextCursor: page.token
          ? seal({ kind: 'cursor', sub, q, token: page.token, exp: serverNow + 3600000 }, secret)
          : null,
        serverNow: new Date(serverNow).toISOString(),
      };
    },
    async start(input: unknown, sub: string) {
      const data = startSchema.parse(input);
      if (data.size > maxBytes)
        throw new ApiError(413, 'FILE_TOO_LARGE', 'Arquivo excede o limite de upload.');
      const secret = await d.ticketSecret();
      const key = `${randomUUID()}--${data.name}`;
      const nonce = randomUUID();
      const uploadId = await d.storage.start(key, data.contentType, {
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
        exp: now() + 24 * 3600000,
      };
      return {
        ticket: seal(payload, secret),
        partSize: PART_BYTES,
        partCount: Math.ceil(data.size / PART_BYTES),
        maxBytes,
      };
    },
    async parts(input: unknown, sub: string) {
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
            url: await d.storage.signPart(
              t.key,
              t.uploadId,
              partNumber,
              Math.min(t.partSize, t.size - (partNumber - 1) * t.partSize),
            ),
          })),
        ),
      };
    },
    async complete(input: unknown, sub: string) {
      const data = completeSchema.parse(input);
      const t = await ticket(data.ticket, sub);
      const already = await existing(t);
      if (already)
        return { file: fileInfo(t.key, already.size, already.created, now(), retention) };
      const count = Math.ceil(t.size / t.partSize);
      if (data.parts.length !== count) throw invalid();
      const parts = [...data.parts].sort((a, b) => a.partNumber - b.partNumber);
      if (parts.some((p, i) => p.partNumber !== i + 1)) throw invalid();
      const actual = await d.storage.listParts(t.key, t.uploadId);
      if (
        actual.length !== count ||
        parts.some((p, i) => {
          const a = actual.find((x) => x.partNumber === p.partNumber);
          return (
            !a || a.etag !== p.etag || a.size !== Math.min(t.partSize, t.size - i * t.partSize)
          );
        })
      )
        throw new ApiError(
          409,
          'PARTS_MISMATCH',
          'Partes incompletas ou inconsistentes. Repita as partes com falha.',
        );
      await d.storage.complete(t.key, t.uploadId, parts);
      const object = await existing(t);
      if (!object)
        throw new ApiError(
          503,
          'UPLOAD_UNCONFIRMED',
          'Não foi possível confirmar o envio. Tente concluir novamente.',
        );
      return { file: fileInfo(t.key, object.size, object.created, now(), retention) };
    },
    async abort(input: unknown, sub: string) {
      const data = abortSchema.parse(input);
      const t = await ticket(data.ticket, sub);
      await d.storage.abort(t.key, t.uploadId);
      return { aborted: true };
    },
    async stream(input: unknown) {
      const { key } = streamSchema.parse(input);
      const object = await d.storage.head(key);
      if (!object) throw missing();
      const serverNow = now();
      const expiry = linkExpiry(object.created, serverNow, retention);
      return {
        url: await d.signStream(`https://${d.mediaDomain}/${encodeKey(key)}`, expiry),
        expiresAt: new Date(expiry).toISOString(),
        serverNow: new Date(serverNow).toISOString(),
      };
    },
  };
}
