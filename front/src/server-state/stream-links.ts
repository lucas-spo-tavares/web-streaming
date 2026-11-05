import { useMutation, useQuery } from '@tanstack/react-query';
import { stream, shortLink } from '@/services/stream-links';

export function useStreamLink(key: string) {
  return useQuery({
    queryKey: ['stream-links', key],
    queryFn: ({ signal }) => stream(key, signal),
    gcTime: 0,
    refetchOnReconnect: false,
  });
}

export const useCreateStreamLink = () =>
  useMutation({
    mutationFn: (key: string) => stream(key),
  });

export const useCreateShortLink = () =>
  useMutation({
    mutationFn: ({ key, code }: { key: string; code?: string }) => shortLink(key, code),
  });
