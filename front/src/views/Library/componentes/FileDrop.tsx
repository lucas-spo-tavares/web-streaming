import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { videoContentType } from '../../../../../config/video.ts';

interface FileDropProps {
  onFiles: (files: File[]) => void;
  onReject: (message: string) => void;
}

export function FileDrop({ onFiles, onReject }: FileDropProps) {
  const [dragging, setDragging] = useState(false);
  const callbacks = useRef({ onFiles, onReject });
  callbacks.current = { onFiles, onReject };

  useEffect(() => {
    let depth = 0;

    function hasFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types ?? []).includes('Files');
    }

    function reset() {
      depth = 0;
      setDragging(false);
    }

    function enter(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    }

    function over(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();

      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }

    function leave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);

      if (depth === 0) setDragging(false);
    }

    function drop(event: DragEvent) {
      reset();

      if (!hasFiles(event)) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      const videos = files.filter((file) => videoContentType(file.name, file.type));

      if (videos.length !== files.length) {
        callbacks.current.onReject(
          'Alguns arquivos foram ignorados. Envie apenas arquivos de vídeo com extensão e tipo compatíveis.',
        );
      }

      if (videos.length > 0) callbacks.current.onFiles(videos);
    }

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);

    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);

  if (!dragging) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 bg-white/85 p-4 backdrop-blur-sm sm:p-6">
      <div
        role="status"
        className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-primary text-primary"
      >
        <Upload className="size-10" />
        <p className="text-xl font-semibold">Solte os vídeos para enviar</p>
      </div>
    </div>
  );
}
