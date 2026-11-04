import { http } from './http';
import type { UploadSession } from './types';

export async function start(file: File) {
  return (
    await http.post<UploadSession>('/uploads', {
      name: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
    })
  ).data;
}

export async function parts(ticket: string, partNumbers: number[]) {
  return (
    await http.post<{ parts: { partNumber: number; url: string }[] }>('/uploads/parts', {
      ticket,
      partNumbers,
    })
  ).data;
}

export async function complete(
  ticket: string,
  parts: { partNumber: number; etag: string }[],
): Promise<unknown> {
  return (await http.post('/uploads/complete', { ticket, parts })).data;
}

export async function abort(ticket: string): Promise<unknown> {
  return (await http.post('/uploads/abort', { ticket })).data;
}
