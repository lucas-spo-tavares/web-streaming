import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { http } from '../src/services/http';
import { auth } from '../src/services/auth';
import { list, remove } from '../src/services/files';
import { ApiError } from '../src/services/types';

vi.mock('../src/services/auth', () => ({
  auth: { token: vi.fn(), refresh: vi.fn(), snapshot: vi.fn(), clear: vi.fn() },
}));
vi.mock('../src/config', () => ({ config: { apiUrl: 'https://api.example.test' } }));

const originalAdapter = http.defaults.adapter;
beforeEach(() => {
  vi.mocked(auth.token).mockResolvedValue('access-token');
  vi.mocked(auth.snapshot).mockReturnValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expires: Date.now() + 900000,
  });
  vi.mocked(auth.refresh).mockImplementation(async () => {
    vi.mocked(auth.token).mockResolvedValue('renewed');
    vi.mocked(auth.snapshot).mockReturnValue({
      accessToken: 'renewed',
      refreshToken: 'refresh-token',
      expires: Date.now() + 900000,
    });
    return 'renewed';
  });
});
afterEach(() => {
  http.defaults.adapter = originalAdapter;
  vi.resetAllMocks();
});

function unauthorized(config: InternalAxiosRequestConfig) {
  const response: AxiosResponse = {
    config,
    data: { code: 'SESSION_EXPIRED', message: 'Entre novamente.' },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
  };
  return new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response);
}

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

  it('refreshes on 401 and replays the original request with the new token', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.headers.get('Authorization') === 'Bearer access-token') throw unauthorized(config);
      expect(config.headers.get('Authorization')).toBe('Bearer renewed');
      expect(JSON.parse(config.data)).toEqual({ key: 'video.mp4' });
      return { config, data: { deleted: true }, status: 200, statusText: 'OK', headers: {} };
    });
    http.defaults.adapter = adapter;
    expect(await remove('video.mp4')).toEqual({ deleted: true });
    expect(auth.refresh).toHaveBeenCalledOnce();
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(auth.clear).not.toHaveBeenCalled();
  });

  it('does not loop when the retried request also returns 401', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw unauthorized(config);
    });
    http.defaults.adapter = adapter;
    const request = list('');
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    expect(auth.refresh).toHaveBeenCalledOnce();
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(auth.clear).toHaveBeenCalledWith('Sua sessão terminou. Entre novamente.');
  });

  it('reuses a newer token when an older request returns a delayed 401', async () => {
    http.defaults.adapter = async (config) => {
      if (config.headers.get('Authorization') === 'Bearer access-token') {
        await auth.refresh(); // Another request finished renewing before this response arrived.
        throw unauthorized(config);
      }
      return { config, data: { files: [] }, status: 200, statusText: 'OK', headers: {} };
    };
    expect(await list('')).toEqual({ files: [] });
    expect(auth.refresh).toHaveBeenCalledOnce();
  });

  it('does not replay a request when refreshing fails', async () => {
    vi.mocked(auth.refresh).mockRejectedValueOnce(
      new Error('Sua sessão terminou. Entre novamente.'),
    );
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw unauthorized(config);
    });
    http.defaults.adapter = adapter;
    await expect(list('')).rejects.toThrow('Sua sessão terminou');
    expect(adapter).toHaveBeenCalledOnce();
  });

  it('preserves non-401 errors without refreshing', async () => {
    http.defaults.adapter = async (config) => {
      const response = {
        config,
        data: { code: 'FORBIDDEN', message: 'Acesso negado.' },
        status: 403,
        statusText: 'Forbidden',
        headers: {},
      };
      throw new AxiosError('Forbidden', 'ERR_BAD_REQUEST', config, undefined, response);
    };
    await expect(list('')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.clear).not.toHaveBeenCalled();
  });
});
