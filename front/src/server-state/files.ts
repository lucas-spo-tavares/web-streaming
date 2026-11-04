import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { list, renew, remove } from '@/services/files';

export const fileKeys = {
  all: ['files'] as const,
  list: (q: string) => ['files', q] as const,
};

export function useLibrary(query: string) {
  const [search, setSearch] = useState(query.trim());

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);

    return () => clearTimeout(timer);
  }, [query]);

  const client = useQueryClient();
  const result = useInfiniteQuery({
    queryKey: fileKeys.list(search),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      let cursor = pageParam;
      let page;
      do {
        page = await list(search, cursor, signal);
        cursor = page.nextCursor ?? undefined;
        // Empty S3 batches can still have further search results.
      } while (!page.files.length && cursor);

      return { ...page, offset: Date.parse(page.serverNow) - Date.now() };
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const pages = result.data?.pages ?? [];

  return {
    files: [
      ...new Map(pages.flatMap((page) => page.files).map((file) => [file.key, file])).values(),
    ],
    loading: result.isFetching || query.trim() !== search,
    error: result.error?.message ?? '',
    nextCursor: pages.at(-1)?.nextCursor ?? null,
    offset: pages.at(-1)?.offset ?? 0,
    more: () => {
      if (!result.isFetching && result.hasNextPage) void result.fetchNextPage();
    },
    refresh: () => {
      void client.resetQueries({ queryKey: fileKeys.all });
    },
  };
}

export function useRenewFile() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (key: string) => renew(key),
    onSuccess: () => client.resetQueries({ queryKey: fileKeys.all }),
  });
}

export function useDeleteFile() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (key: string) => remove(key),
    onSuccess: () => client.resetQueries({ queryKey: fileKeys.all }),
  });
}
