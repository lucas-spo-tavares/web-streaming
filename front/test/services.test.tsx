import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import { http } from '../src/services/http';
import { auth } from '../src/services/auth';
import { list, remove } from '../src/services/files';
import { ApiError } from '../src/services/types';

vi.mock('../src/services/auth', () => ({
  auth: { token: vi.fn(async () => 'access-token'), clear: vi.fn() },
}));
const originalAdapter = http.defaults.adapter;
afterEach(() => {
  http.defaults.adapter = originalAdapter;
  vi.clearAllMocks();
});

vi.mock('../src/config', () => ({ config: { apiUrl: 'https://api.example.test' } }));

describe('authenticated services', () => {
  it('attaches the current token and sends the delete body', async () => {
    http.defaults.adapter = async (config) => {
      expect(config.headers.get('Authorization')).toBe('Bearer access-token');
      expect(config.url).toBe('/files');
      expect(config.method).toBe('delete');
      expect(JSON.parse(config.data)).toEqual({ key: 'video.mp4' });
      return { config, data: { deleted: true }, status: 200, statusText: 'OK', headers: {} };
    };
    expect(await remove('video.mp4')).toEqual({ deleted: true });
  });

  it('expires the session on 401 and preserves the API error code', async () => {
    http.defaults.adapter = async (config) => {
      const response: AxiosResponse = {
        config,
        data: { code: 'SESSION_EXPIRED', message: 'Entre novamente.' },
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
      };
      throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response);
    };
    const request = list('');
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
      message: 'Entre novamente.',
    });
    expect(auth.clear).toHaveBeenCalledWith('Sua sessão terminou. Entre novamente.');
  });
});
