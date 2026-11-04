// @vitest-environment happy-dom
import '../src/extensions';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../src/server-state/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Library } from '../src/views/Library';
import { list, renew, remove } from '../src/services/files';
import { download } from '../src/services/download-links';
import { stream, shortLink } from '../src/services/stream-links';

vi.mock('../src/services/stream-links', () => ({ stream: vi.fn(), shortLink: vi.fn() }));

vi.mock('../src/services/files', () => ({
  list: vi.fn(),
  renew: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../src/services/download-links', () => ({
  download: vi.fn(),
}));

const file = {
  key: '12345678-1234-4123-8123-123456789abc--vídeo.mp4',
  name: 'vídeo.mp4',
  size: 100,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  expired: false,
};
const page = { files: [file], nextCursor: null, serverNow: new Date().toISOString() };
function setup(expired = false) {
  const api = {
    list: vi.fn(async () => ({
      ...page,
      serverNow: new Date().toISOString(),
      files: [
        { ...file, expiresAt: new Date(Date.now() + (expired ? -1000 : 86400000)).toISOString() },
      ],
    })),
    renew: vi.fn(async () => ({
      file: { ...file, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() },
      serverNow: new Date().toISOString(),
    })),
    download: vi.fn(async () => ({
      url: 'https://s3.acervo.test/signed-download',
      expiresAt: file.expiresAt,
      serverNow: page.serverNow,
    })),
    start: vi.fn(),
    parts: vi.fn(),
    complete: vi.fn(),
    abort: vi.fn(),
    delete: vi.fn(),
    stream: vi.fn(async () => ({
      url: 'https://media.test/signed',
      expiresAt: file.expiresAt,
      serverNow: page.serverNow,
    })),
    short: vi.fn(async () => ({
      url: 'https://link.lucas-tavares.com/abcdef',
      expiresAt: file.expiresAt,
      serverNow: page.serverNow,
    })),
  };
  vi.mocked(stream).mockImplementation(api.stream);
  vi.mocked(shortLink).mockImplementation(api.short);
  vi.mocked(list).mockImplementation(api.list);
  vi.mocked(renew).mockImplementation(api.renew);
  vi.mocked(remove).mockImplementation(api.delete);
  vi.mocked(download).mockImplementation(api.download);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <Routes>
          <Route element={<Library logout={vi.fn()} />}>
            <Route index element={null} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('file actions', () => {
  it('calls the shortener only when copying a short link and copies its result', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const api = setup();
    const shortButton = await screen.findByRole('button', {
      name: 'Copiar link curto de vídeo.mp4',
    });
    expect(api.short).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link de vídeo.mp4' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://media.test/signed'));
    expect(api.short).not.toHaveBeenCalled();
    await waitFor(() => expect((shortButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(shortButton);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://link.lucas-tavares.com/abcdef'),
    );
    expect(api.short).toHaveBeenCalledExactlyOnceWith(file.key);
    expect(api.stream).toHaveBeenCalledOnce();
  });
  it('shows a shortener failure and re-enables the short link button', async () => {
    const api = setup();
    api.short.mockRejectedValueOnce(new Error('Encurtador indisponível.'));
    const button = await screen.findByRole('button', { name: 'Copiar link curto de vídeo.mp4' });
    fireEvent.click(button);
    expect(await screen.findByText('Encurtador indisponível.')).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('renews the selected video and refreshes its expiry', async () => {
    const api = setup();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reiniciar expiração de vídeo.mp4' }),
    );
    await waitFor(() => expect(api.renew).toHaveBeenCalledWith(file.key));
    expect(await screen.findByText(/Prazo de vídeo.mp4 reiniciado/)).toBeTruthy();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
  it('starts a direct download using the signed URL and original name', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.href).toBe('https://s3.acervo.test/signed-download');
      expect(this.download).toBe(file.name);
    });
    const api = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Baixar vídeo.mp4' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(api.download).toHaveBeenCalledWith(file.key, expect.any(AbortSignal));
    expect(screen.getByText('Download de vídeo.mp4 iniciado.')).toBeTruthy();
  });
  it('allows renewing a pending expired video while blocking download', async () => {
    setup(true);
    const button = await screen.findByRole('button', { name: 'Baixar vídeo.mp4' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Reiniciar expiração de vídeo.mp4',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it('reports a renewal failure and re-enables the actions', async () => {
    const api = setup();
    vi.mocked(api.renew).mockRejectedValue(new Error('Não foi possível renovar.'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reiniciar expiração de vídeo.mp4' }),
    );
    expect(await screen.findByText('Não foi possível renovar.')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Reiniciar expiração de vídeo.mp4',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
