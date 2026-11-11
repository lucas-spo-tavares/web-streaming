import { http } from './http';
import type { SubtitleManifest } from '../../../config/subtitles';

export async function subtitles(key: string, signal?: AbortSignal) {
  const uuid = key.split('/')[0];

  return (
    await http.get<SubtitleManifest>(`/videos/${encodeURIComponent(uuid)}/subtitles`, { signal })
  ).data;
}

export async function subtitleText(key: string, track: number, signal?: AbortSignal) {
  const uuid = key.split('/')[0];

  return (
    await http.get<string>(`/videos/${encodeURIComponent(uuid)}/subtitles/${track}`, {
      signal,
      responseType: 'text',
    })
  ).data;
}
