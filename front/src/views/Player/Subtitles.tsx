import { useEffect, useState, type ChangeEvent, type RefObject } from 'react';
import { useSubtitles, useSubtitleText } from '@/server-state/subtitles';
import { Button } from '@/components/ui/button';
import type { SubtitleTrack } from '../../../../config/subtitles';

function label(track: SubtitleTrack) {
  let language = track.language;

  try {
    language = new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(language) ?? language;
  } catch {
    /* Preserve unknown language tags. */
  }

  return `${track.label === track.language ? language : track.label}${track.forced ? ' — forçada' : ''}`;
}

function renderTrack(track: SubtitleTrack) {
  return (
    <option key={track.number} value={track.number} disabled={!track.supported}>
      {label(track)}
      {!track.supported ? ' — formato não suportado' : ''}
    </option>
  );
}

export function Subtitles({
  fileName,
  enabled,
  video,
  sourceId,
}: {
  fileName: string;
  enabled: boolean;
  video: RefObject<HTMLVideoElement | null>;
  sourceId: string;
}) {
  const query = useSubtitles(fileName, enabled);
  const tracks = query.data?.tracks ?? [];
  const preferred =
    tracks.find((track) => track.supported && /^(pt|por)(-|$)/i.test(track.language)) ??
    tracks.find((track) => track.supported && track.default) ??
    tracks.find((track) => track.supported);
  const [selected, setSelected] = useState<number | null>();
  const number = selected === undefined ? preferred?.number : (selected ?? undefined);
  const track = tracks.find((item) => item.number === number && item.supported);
  const text = useSubtitleText(fileName, track?.number);
  const [trackError, setTrackError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = video.current;

    if (!element || !track || !text.data) return;
    const url = URL.createObjectURL(new Blob([text.data], { type: 'text/vtt' }));
    const caption = document.createElement('track');
    caption.kind = 'subtitles';
    caption.src = url;
    caption.label = label(track);
    caption.srclang = track.language;
    caption.default = true;

    function handleError() {
      setTrackError('O navegador não conseguiu exibir esta legenda.');
    }
    caption.addEventListener('error', handleError);
    element.appendChild(caption);
    caption.track.mode = 'showing';

    return () => {
      caption.track.mode = 'disabled';
      caption.removeEventListener('error', handleError);
      caption.remove();
      URL.revokeObjectURL(url);
    };
  }, [video, sourceId, track, text.data, attempt]);

  function handleSelection(event: ChangeEvent<HTMLSelectElement>) {
    setSelected(event.target.value === '' ? null : Number(event.target.value));
    setTrackError('');
  }

  function handleRetry() {
    setTrackError('');
    setAttempt((value) => value + 1);

    if (text.error) void text.refetch();
    else void query.refetch();
  }

  const error =
    query.error?.message ||
    text.error?.message ||
    trackError ||
    (query.data?.status === 'failed' ? query.data.message : '');

  return (
    <div className="mt-4 space-y-2 text-sm">
      {(query.isLoading || query.data?.status === 'processing') && (
        <p role="status" className="text-muted-foreground">
          Preparando legendas… Você pode continuar assistindo.
        </p>
      )}
      {query.data?.status === 'ready' &&
        (tracks.length ? (
          <label className="flex flex-wrap items-center gap-3">
            Legenda
            <select
              aria-label="Legenda"
              value={number ?? ''}
              onChange={handleSelection}
              className="h-9 max-w-full rounded-md border bg-background px-3 text-foreground"
            >
              <option value="">Desativada</option>
              {tracks.map(renderTrack)}
            </select>
          </label>
        ) : (
          <p className="text-muted-foreground">Este vídeo não tem legendas de texto disponíveis.</p>
        ))}
      {tracks.some((item) => !item.supported) && (
        <p className="text-muted-foreground">
          Algumas faixas usam legendas em imagem ou formatos não suportados.
        </p>
      )}
      {error && (
        <div role="alert">
          <p className="mb-2 text-destructive">{error}</p>
          <Button size="sm" variant="outline" onClick={handleRetry}>
            Verificar legendas novamente
          </Button>
        </div>
      )}
    </div>
  );
}
