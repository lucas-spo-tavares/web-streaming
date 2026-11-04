// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createQueryClient } from '../src/server-state/client';
import { useLibrary } from '../src/server-state/files';
import { list as listFiles } from '../src/services/files';

vi.mock('../src/services/files', () => ({ list: vi.fn() }));
type ListFiles = typeof listFiles;

const file = {
  key: 'video.mp4',
  name: 'video.mp4',
  size: 100,
  createdAt: new Date().toISOString(),
  expiresAt: new Date().toISOString(),
  expired: false,
};
function setup(list: ListFiles) {
  vi.mocked(listFiles).mockImplementation(list);
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ query }) => useLibrary(query), {
    initialProps: { query: '' },
    wrapper,
  });
}
afterEach(cleanup);

describe('library pagination', () => {
  it('continues past empty S3 batches and deduplicates subsequent pages', async () => {
    const serverNow = new Date().toISOString();
    const list = vi
      .fn<ListFiles>()
      .mockResolvedValueOnce({ files: [], nextCursor: 'empty', serverNow })
      .mockResolvedValueOnce({ files: [file], nextCursor: 'next', serverNow })
      .mockResolvedValueOnce({
        files: [file, { ...file, key: 'other.mp4' }],
        nextCursor: null,
        serverNow,
      });
    const { result } = setup(list);
    await waitFor(() => expect(result.current.files).toHaveLength(1));
    expect(list).toHaveBeenNthCalledWith(2, '', 'empty', expect.any(AbortSignal));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.files).toHaveLength(2));
    expect(result.current.nextCursor).toBeNull();
  });

  it('cancels the previous search and ignores its late response', async () => {
    let resolveOld!: (page: Awaited<ReturnType<ListFiles>>) => void;
    const serverNow = new Date().toISOString();
    const list = vi
      .fn<ListFiles>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ files: [{ ...file, key: 'new.mp4' }], nextCursor: null, serverNow });
    const { result, rerender } = setup(list);
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    const signal = list.mock.calls[0][2]!;
    rerender({ query: 'new' });
    await waitFor(() => expect(result.current.files[0]?.key).toBe('new.mp4'));
    expect(signal.aborted).toBe(true);
    await act(async () => resolveOld({ files: [file], nextCursor: null, serverNow }));
    expect(result.current.files[0].key).toBe('new.mp4');
  });
});
