import { http } from './http';
import type { StreamLink } from './types';

export async function stream(key: string, signal?: AbortSignal) {
  return (await http.post<StreamLink>('/stream-links', { key }, { signal })).data;
}

export async function shortLink(key: string, code?: string, signal?: AbortSignal) {
  return (await http.post<StreamLink>('/short-links', { key, code }, { signal })).data;
}
