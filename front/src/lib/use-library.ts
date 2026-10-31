import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryApi, VideoFile } from './api';
export function useLibrary(api: LibraryApi, query: string) {
  const [files, setFiles] = useState<VideoFile[]>([]);
  const [nextCursor, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const load = useCallback(
    async (
      q: string,
      cursor: string | undefined,
      reset: boolean,
      id: number,
      abort: AbortController,
    ) => {
      setLoading(true);
      setError('');
      try {
        let current = cursor;
        let page;
        do {
          page = await api.list(q, current, abort.signal);
          current = page.nextCursor ?? undefined;
          if (abort.signal.aborted || generation.current !== id) return;
          // An empty S3 batch with a cursor is not the end of a global search.
        } while (!page.files.length && current);
        setFiles((previous) => {
          const combined = reset ? page.files : [...previous, ...page.files];
          return [...new Map(combined.map((file) => [file.key, file])).values()];
        });
        setOffset(Date.parse(page.serverNow) - Date.now());
        setNext(page.nextCursor);
      } catch (cause) {
        if (!abort.signal.aborted && generation.current === id)
          setError(cause instanceof Error ? cause.message : 'Falha ao carregar os arquivos.');
      } finally {
        if (!abort.signal.aborted && generation.current === id) setLoading(false);
      }
    },
    [api],
  );
  useEffect(() => {
    const id = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setFiles([]);
    setNext(null);
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void load(query.trim(), undefined, true, id, abort);
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, revision, load]);
  const more = () => {
    if (loading) return;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    void load(query.trim(), nextCursor ?? undefined, files.length === 0, generation.current, abort);
  };
  return {
    files,
    loading,
    error,
    nextCursor,
    offset,
    more,
    refresh: () => setRevision((v) => v + 1),
  };
}
