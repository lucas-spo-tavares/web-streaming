import { http } from './http';
import type { FilePage, VideoFile } from './types';

export async function list(q: string, cursor?: string, signal?: AbortSignal) {
  return (await http.get<FilePage>('/files', { params: { q, cursor }, signal })).data;
}

export async function renew(key: string) {
  return (await http.post<{ file: VideoFile; serverNow: string }>('/files/renew', { key })).data;
}

export async function remove(key: string) {
  return (await http.delete<{ deleted: true }>('/files', { data: { key } })).data;
}
