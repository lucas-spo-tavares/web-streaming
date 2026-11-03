import type { FilePage, VideoFile } from '../../../back/src/contracts';
import { config } from '@/config';
export type { VideoFile, FilePage } from '../../../back/src/contracts';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface UploadSession {
  ticket: string;
  partSize: number;
  partCount: number;
  maxBytes: number;
}
export interface StreamLink {
  url: string;
  expiresAt: string;
  serverNow: string;
}
export interface LibraryApi {
  list(q: string, cursor?: string, signal?: AbortSignal): Promise<FilePage>;
  start(file: File): Promise<UploadSession>;
  parts(
    ticket: string,
    partNumbers: number[],
  ): Promise<{ parts: { partNumber: number; url: string }[] }>;
  complete(ticket: string, parts: { partNumber: number; etag: string }[]): Promise<unknown>;
  abort(ticket: string): Promise<unknown>;
  renew(key: string): Promise<{ file: VideoFile; serverNow: string }>;
  download(key: string): Promise<StreamLink>;
  delete(key: string): Promise<{ deleted: true }>;
  stream(key: string, signal?: AbortSignal): Promise<StreamLink>;
}
export function createApi(token: () => Promise<string>, unauthorized: () => void): LibraryApi {
  async function request<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    const access = await token();
    const response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${access}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
    if (response.status === 401) unauthorized();
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        error.code ?? 'REQUEST_FAILED',
        error.message ?? 'Não foi possível concluir a operação. Tente novamente.',
      );
    }
    return response.json() as Promise<T>;
  }
  return {
    list: (q, cursor, signal) =>
      request(
        `/files?${new URLSearchParams({ q, ...(cursor ? { cursor } : {}) })}`,
        undefined,
        signal,
      ),
    start: (file) =>
      request('/uploads', {
        name: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
      }),
    parts: (ticket, partNumbers) => request('/uploads/parts', { ticket, partNumbers }),
    complete: (ticket, parts) => request('/uploads/complete', { ticket, parts }),
    abort: (ticket) => request('/uploads/abort', { ticket }),
    renew: (key) => request('/files/renew', { key }),
    download: (key) => request('/download-links', { key }),
    delete: (key) => request('/files', { key }, undefined, 'DELETE'),
    stream: (key, signal) => request('/stream-links', { key }, signal),
  };
}
