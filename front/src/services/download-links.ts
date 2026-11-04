import { http } from './http';
import type { StreamLink } from './types';

export async function download(key: string, signal?: AbortSignal) {
  return (await http.post<StreamLink>('/download-links', { key }, { signal })).data;
}
