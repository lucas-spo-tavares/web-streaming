import { useMutation } from '@tanstack/react-query';
import type { UploadJob } from '@/lib/upload';

// UploadJob owns multipart retries, progress and cancellation; automatic retries stay disabled.
export function useUploadJob() {
  return useMutation({
    mutationFn: (job: UploadJob) => job.run(),
    retry: false,
  });
}
