import { z } from 'zod';
import { videoContentType } from '../../config/video.ts';

export const MAX_BYTES = 20 * 1024 ** 3;
export const PART_BYTES = 16 * 1024 ** 2;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const LINK_MS = 4 * 60 * 60 * 1000;
export const nameSchema = z
  .string()
  .min(1)
  .max(220)
  .refine(
    (v) =>
      v.trim().length > 0 &&
      !/[\\/]/u.test(v) &&
      ![...v].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) &&
      !['.', '..'].includes(v),
    'Nome inválido',
  );
export const keySchema = z.string().refine((v) => {
  const match = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(.+)$/u.exec(
    v,
  );
  return Boolean(match && nameSchema.safeParse(match[1]).success && videoContentType(match[1]));
}, 'Chave inválida');
export const startSchema = z
  .object({
    name: nameSchema,
    size: z.number().int().positive(),
    contentType: z.string().max(100).default(''),
  })
  .strict()
  .refine((data) => videoContentType(data.name, data.contentType) !== null, {
    message: 'Envie apenas arquivos de vídeo com extensão e tipo compatíveis.',
    path: ['contentType'],
  })
  .transform((data) => ({ ...data, contentType: videoContentType(data.name, data.contentType)! }));
export const ticketSchema = z.string().min(10).max(8192);
export const partsSchema = z
  .object({
    ticket: ticketSchema,
    partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(10),
  })
  .strict();
export const completeSchema = z
  .object({
    ticket: ticketSchema,
    parts: z
      .array(
        z
          .object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(200) })
          .strict(),
      )
      .min(1)
      .max(1280),
  })
  .strict();
export const abortSchema = z.object({ ticket: ticketSchema }).strict();
export const renewSchema = z.object({ key: keySchema }).strict();
export const downloadSchema = z.object({ key: keySchema }).strict();
export const deleteSchema = z.object({ key: keySchema }).strict();
export const streamSchema = z.object({ key: keySchema }).strict();
export const subtitleSchema = z
  .object({
    uuid: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    track: z.coerce.number().int().min(0).max(255).optional(),
  })
  .strict();
export const subtitleManifestSchema = z.object({
  key: keySchema,
  sourceETag: z.string(),
  status: z.enum(['processing', 'ready', 'failed']),
  message: z.string().max(256).optional(),
  tracks: z
    .array(
      z.object({
        number: z.number().int().min(0).max(255),
        language: z.string().max(32),
        label: z.string().max(256),
        codec: z.string().max(64),
        default: z.boolean(),
        forced: z.boolean(),
        supported: z.boolean(),
        srt: z
          .string()
          .regex(/^\d+-[a-zA-Z0-9-]+\.srt$/)
          .optional(),
        vtt: z
          .string()
          .regex(/^\d+-[a-zA-Z0-9-]+\.vtt$/)
          .optional(),
      }),
    )
    .max(32),
});
export const shortSchema = streamSchema.extend({
  code: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
    .optional(),
});
export const listSchema = z
  .object({ q: z.string().max(220).default(''), cursor: z.string().max(16384).optional() })
  .strict();
export const fileSchema = z.object({
  key: keySchema,
  name: z.string(),
  size: z.number(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  expired: z.boolean(),
});
export const listResponseSchema = z.object({
  files: z.array(fileSchema),
  nextCursor: z.string().nullable(),
  serverNow: z.string().datetime(),
});
export const startResponseSchema = z.object({
  ticket: z.string(),
  partSize: z.number(),
  partCount: z.number(),
  maxBytes: z.number(),
});
export const partsResponseSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number(), url: z.string().url() })),
});
export const streamResponseSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string().datetime(),
  serverNow: z.string().datetime(),
});
export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
});
export type VideoFile = z.infer<typeof fileSchema>;
export type FilePage = z.infer<typeof listResponseSchema>;
