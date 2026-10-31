import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { keySchema, LINK_MS, RETENTION_MS, type VideoFile } from './contracts.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const invalid = () => new ApiError(400, 'INVALID_INPUT', 'Dados inválidos.');
export const missing = () => new ApiError(404, 'NOT_FOUND', 'Arquivo não encontrado.');
export function fileInfo(
  key: string,
  size: number,
  created: Date,
  now: number,
  retention = RETENTION_MS,
): VideoFile {
  const expires = created.getTime() + retention;
  return {
    key,
    name: key.slice(38),
    size,
    createdAt: created.toISOString(),
    expiresAt: new Date(expires).toISOString(),
    expired: now >= expires,
  };
}
export function encodeKey(key: string) {
  return encodeURIComponent(key).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
export function linkExpiry(created: Date, now: number, retention = RETENTION_MS) {
  const end = Math.min(now + LINK_MS, created.getTime() + retention);
  if (end <= now)
    throw new ApiError(410, 'EXPIRED', 'Retenção encerrada. Exclusão pendente no armazenamento.');
  return Math.floor(end / 1000) * 1000;
}
const uploadPayload = z
  .object({
    kind: z.literal('upload'),
    sub: z.string(),
    key: keySchema,
    uploadId: z.string(),
    size: z.number().int().positive(),
    partSize: z.number().int().positive(),
    nonce: z.string().uuid(),
    exp: z.number(),
  })
  .strict();
const cursorPayload = z
  .object({
    kind: z.literal('cursor'),
    sub: z.string(),
    q: z.string(),
    token: z.string(),
    exp: z.number(),
  })
  .strict();
export type UploadTicket = z.infer<typeof uploadPayload>;
export function seal(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function unseal(value: string, secret: string): unknown {
  try {
    const [body, sig, extra] = value.split('.');
    if (!body || !sig || extra) throw invalid();
    const expected = createHmac('sha256', secret).update(body).digest();
    const received = Buffer.from(sig, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      throw invalid();
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    throw invalid();
  }
}
export function readUpload(value: string, secret: string, sub: string, now: number): UploadTicket {
  const data = uploadPayload.safeParse(unseal(value, secret));
  if (!data.success || data.data.sub !== sub) throw invalid();
  if (data.data.exp <= now)
    throw new ApiError(409, 'UPLOAD_EXPIRED', 'Sessão de envio vencida. Inicie um novo upload.');
  return data.data;
}
export function readCursor(value: string, secret: string, sub: string, q: string, now: number) {
  const data = cursorPayload.safeParse(unseal(value, secret));
  if (!data.success || data.data.sub !== sub || data.data.q !== q || data.data.exp <= now)
    throw invalid();
  return data.data.token;
}
export const uuid = randomUUID;
