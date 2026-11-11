// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../src/server-state/client';
import { Subtitles } from '../src/views/Player/Subtitles';
import { subtitles, subtitleText } from '../src/services/subtitles';

vi.mock('../src/services/subtitles', () => ({ subtitles: vi.fn(), subtitleText: vi.fn() }));
const key = '12345678-1234-4123-8123-123456789abc/filme.mkv';
const track = {
  number: 3,
  label: 'Português',
  language: 'por',
  codec: 'subrip',
  default: false,
  forced: false,
  supported: true,
};
const ready = {
  status: 'ready' as const,
  tracks: [{ ...track, number: 2, language: 'eng', label: 'English', default: true }, track],
};
beforeEach(() => {
  vi.mocked(subtitles).mockResolvedValue(ready);
  vi.mocked(subtitleText).mockResolvedValue('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOlá');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:subtitle');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
function Preview({ source = 'first' }: { source?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  return (
    <>
      <video ref={video} key={source} aria-label="Vídeo" />
      <Subtitles fileName={key} video={video} enabled sourceId={source} />
    </>
  );
}
function setup() {
  const client = createQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <Preview />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('extracted subtitle player', () => {
  it('loads Portuguese via the authenticated service and adds a native Blob track', async () => {
    setup();
    const select = (await screen.findByRole('combobox', { name: 'Legenda' })) as HTMLSelectElement;
    expect(select.value).toBe('3');
    await waitFor(() => expect(document.querySelector('track')).not.toBeNull());
    const caption = document.querySelector('track') as HTMLTrackElement;
    expect(caption.src).toBe('blob:subtitle');
    expect(caption.track.mode).toBe('showing');
    expect(subtitleText).toHaveBeenCalledWith(key, 3, expect.any(AbortSignal));
  });
  it('changes language and disables captions without resetting the video', async () => {
    setup();
    const select = await screen.findByRole('combobox', { name: 'Legenda' });
    await waitFor(() => expect(document.querySelector('track')).not.toBeNull());
    const video = screen.getByLabelText('Vídeo');
    fireEvent.change(select, { target: { value: '2' } });
    await waitFor(() => expect(subtitleText).toHaveBeenCalledWith(key, 2, expect.any(AbortSignal)));
    await waitFor(() => expect(document.querySelectorAll('track')).toHaveLength(1));
    fireEvent.change(select, { target: { value: '' } });
    expect(document.querySelector('track')).toBeNull();
    expect(screen.getByLabelText('Vídeo')).toBe(video);
  });
  it('reattaches the track on reload and frees Blob URLs', async () => {
    const { rerender, client, unmount } = setup();
    await waitFor(() => expect(document.querySelector('track')).not.toBeNull());
    const old = screen.getByLabelText('Vídeo');
    rerender(
      <QueryClientProvider client={client}>
        <Preview source="retry" />
      </QueryClientProvider>,
    );
    expect(document.querySelector('video track')).not.toBeNull();
    expect(old.querySelector('track')).toBeNull();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it('keeps playback available during processing or failure and can recheck status', async () => {
    vi.mocked(subtitles)
      .mockResolvedValueOnce({ status: 'failed', tracks: [], message: 'Extração interrompida.' })
      .mockResolvedValue(ready);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar legendas novamente' }));
    expect(await screen.findByRole('combobox')).toBeTruthy();
    expect(screen.getByLabelText('Vídeo')).toBeTruthy();
  });
  it('does not download incompatible image tracks', async () => {
    vi.mocked(subtitles).mockResolvedValue({
      status: 'ready',
      tracks: [{ ...track, supported: false, codec: 'hdmv_pgs_subtitle' }],
    });
    setup();
    expect(((await screen.findByRole('combobox')) as HTMLSelectElement).value).toBe('');
    expect(subtitleText).not.toHaveBeenCalled();
  });
});
