import { useQueryClient } from '@tanstack/react-query';
import { download } from '@/services/download-links';

export function useDownloadLink() {
  const queryClient = useQueryClient();

  return (key: string) =>
    queryClient.query({
      queryKey: ['download-links', key],
      queryFn: ({ signal }) => download(key, signal),
      staleTime: 0,
      gcTime: 0,
    });
}
