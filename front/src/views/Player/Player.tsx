import { useStreamLink } from '@/server-state/stream-links';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Film, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Subtitles } from './Subtitles';

export function Player() {
  const { fileName = '' } = useParams();

  return <FilePlayer key={fileName} fileName={fileName} />;
}

function FilePlayer({ fileName }: { fileName: string }) {
  const name = fileName.split('/').at(-1) ?? '';
  const stream = useStreamLink(fileName);
  const link = stream.data;
  const [playbackError, setError] = useState('');
  const error = playbackError || stream.error?.message || '';
  const loading = stream.isFetching;
  const video = useRef<HTMLVideoElement>(null);

  function handleError() {
    setError(
      'Não foi possível reproduzir o vídeo. Tente novamente ou abra o link no VLC pela biblioteca.',
    );
  }

  function handleRetry() {
    setError('');
    void stream.refetch();
  }

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-8">
        <Link to="/">
          <ArrowLeft />
          Voltar à biblioteca
        </Link>
      </Button>
      <p className="mb-3 flex items-center gap-2 text-xs font-medium tracking-widest text-muted-foreground uppercase">
        <Film className="size-4" />
        Assistir no acervo
      </p>
      <h1 className="mb-6 text-2xl font-semibold break-all sm:text-3xl">{name}</h1>
      {loading && (
        <div
          role="status"
          className="flex aspect-video items-center justify-center gap-3 rounded-xl bg-[#101b16] text-white"
        >
          <Loader2 className="size-5 animate-spin" />
          Abrindo vídeo…
        </div>
      )}
      {link && !error && !loading && (
        <video
          ref={video}
          key={link.url}
          src={link.url}
          controls
          playsInline
          preload="metadata"
          aria-label={`Reproduzir ${name}`}
          className="aspect-video w-full rounded-xl bg-black shadow-sm"
          onError={handleError}
        >
          Seu navegador não oferece suporte à reprodução de vídeo.
        </video>
      )}
      <Subtitles
        fileName={fileName}
        enabled={Boolean(link)}
        video={video}
        sourceId={`${link?.url}:${loading}:${Boolean(error)}`}
      />
      {error && (
        <div role="alert" className="rounded-xl border bg-card p-6">
          <p className="mb-4 text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={handleRetry}>
            <RefreshCw />
            Tentar novamente
          </Button>
        </div>
      )}
      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
        Use os controles do player para reproduzir, ajustar o volume e abrir em tela cheia. A
        reprodução depende dos formatos e codecs compatíveis com seu navegador.
      </p>
    </>
  );
}
