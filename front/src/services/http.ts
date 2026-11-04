import axios from 'axios';
import { config } from '@/config';
import { auth } from './auth';
import { ApiError } from './types';

export const http = axios.create({ baseURL: config.apiUrl });

http.interceptors.request.use(async (request) => {
  request.headers.set('Authorization', `Bearer ${await auth.token()}`);

  return request;
});

http.interceptors.response.use(undefined, (error: unknown) => {
  if (!axios.isAxiosError(error) || !error.response) return Promise.reject(error);
  const { status, data } = error.response;

  if (status === 401) auth.clear('Sua sessão terminou. Entre novamente.');

  return Promise.reject(
    new ApiError(
      status,
      data?.code ?? 'REQUEST_FAILED',
      data?.message ?? 'Não foi possível concluir a operação. Tente novamente.',
    ),
  );
});
