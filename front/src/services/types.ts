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
