export interface SubtitleTrack {
  number: number;
  language: string;
  label: string;
  codec: string;
  default: boolean;
  forced: boolean;
  supported: boolean;
  srt?: string;
  vtt?: string;
}
export interface SubtitleManifest {
  status: 'processing' | 'ready' | 'failed';
  tracks: SubtitleTrack[];
  message?: string;
}
