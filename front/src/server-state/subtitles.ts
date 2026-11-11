import { useQuery } from '@tanstack/react-query';
import { subtitles, subtitleText } from '@/services/subtitles';

export function useSubtitles(key: string, enabled: boolean) {
  return useQuery({
    queryKey: ['subtitles', key],
    queryFn: ({ signal }) => subtitles(key, signal),
    enabled,
    staleTime: 60000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? 5000 : false),
  });
}

export function useSubtitleText(key: string, track?: number) {
  return useQuery({
    queryKey: ['subtitle-text', key, track],
    queryFn: ({ signal }) => subtitleText(key, track!, signal),
    enabled: track !== undefined,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}
