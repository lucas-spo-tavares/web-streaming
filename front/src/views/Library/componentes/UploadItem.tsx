import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { UploadState } from '@/lib/upload';

interface UploadItemProps {
  job: UploadState;
  onRetry: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}

export function UploadItem({ job, onRetry, onCancel, onDismiss }: UploadItemProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{job.name}</p>
          <p className="text-xs text-muted-foreground">
            {job.size.appBytesFormat()} · {job.message ?? `${job.progress}%`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {job.status === 'error' && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Tentar novamente
            </Button>
          )}
          {(job.status === 'sending' || job.status === 'error') && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Cancelar envio de ${job.name}`}
              onClick={onCancel}
            >
              <X />
              Cancelar
            </Button>
          )}
          {job.status === 'complete' && <Check className="size-4 text-primary" />}
          {(job.status === 'complete' || job.status === 'cancelled') && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Dispensar ${job.name}`}
              onClick={onDismiss}
            >
              <X />
            </Button>
          )}
        </div>
      </div>
      <Progress value={job.progress} aria-label={`Progresso de ${job.name}`} />
    </div>
  );
}
