import { validateFront } from '../../config/environment.mjs';

export interface AppConfig {
  apiUrl: string;
  clientId: string;
  region: string;
}

export const config: AppConfig = {
  apiUrl: (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, ''),
  clientId: import.meta.env.VITE_CLIENT_ID ?? '',
  region: import.meta.env.VITE_AWS_REGION ?? '',
};

export const isConfigured =
  validateFront({
    VITE_API_URL: config.apiUrl,
    VITE_CLIENT_ID: config.clientId,
    VITE_AWS_REGION: config.region,
  }).length === 0;
