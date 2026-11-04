import axios, { type InternalAxiosRequestConfig } from 'axios';
import { config } from '@/config';
import { auth } from './auth';
import { ApiError } from './types';

type AuthRequestConfig = InternalAxiosRequestConfig & {
  authRetried?: boolean;
};

export const http = axios.create({ baseURL: config.apiUrl });

http.interceptors.request.use(async (request) => {
  request.headers.set('Authorization', `Bearer ${await auth.token()}`);

  return request;
});

http.interceptors.response.use(undefined, async (error: unknown) => {
  if (!axios.isAxiosError(error) || !error.response) return Promise.reject(error);
  const { status, data } = error.response;
  const request = error.config as AuthRequestConfig | undefined;

  if (status === 401 && request) {
    if (!request.authRetried) {
      request.authRetried = true;
      const session = auth.snapshot();
      const rejectedToken = request.headers.get('Authorization');

      // A late 401 for an older token can reuse a refresh already completed by another request.
      if (!session || rejectedToken === `Bearer ${session.accessToken}`) await auth.refresh();

      return http.request(request);
    }

    if (request.headers.get('Authorization') === `Bearer ${auth.snapshot()?.accessToken}`)
      auth.clear('Sua sessão terminou. Entre novamente.');
  }

  return Promise.reject(
    new ApiError(
      status,
      data?.code ?? 'REQUEST_FAILED',
      data?.message ?? 'Não foi possível concluir a operação. Tente novamente.',
    ),
  );
});
