import { validateFront } from '../../config/environment.ts';

export const config = {
  apiUrl: (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, ''),
  clientId: import.meta.env.VITE_CLIENT_ID ?? '',
  region: import.meta.env.VITE_AWS_REGION ?? '',
};

export type AppConfig = typeof config;

export const isConfigured =
  validateFront({
    VITE_API_URL: config.apiUrl,
    VITE_CLIENT_ID: config.clientId,
    VITE_AWS_REGION: config.region,
  }).length === 0;
