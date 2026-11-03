import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Film, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './components/ui/button';
import type { LibraryApi, StreamLink } from './lib/api';

export function Player({ api }: { api: LibraryApi }) {
  const { fileName = '' } = useParams();
  // S3 stores the original filename after a unique UUID prefix, avoiding duplicate-name ambiguity.
  const name = fileName.replace(/^[0-9a-f-]{36}--/, '');
  const [link, setLink] = useState<StreamLink | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setLink(null);
    void api.stream(fileName, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setLink(result);
          setLoading(false);
        }
      },
      (cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o vídeo.');
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [api, fileName, revision]);

  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
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
        {link && !error && (
          <video
            key={link.url}
            src={link.url}
            controls
            playsInline
            preload="metadata"
            aria-label={`Reproduzir ${name}`}
            className="aspect-video w-full rounded-xl bg-black shadow-sm"
            onError={() =>
              setError(
                'Não foi possível reproduzir o vídeo. O link pode ter expirado ou o formato e os codecs podem ser incompatíveis com este navegador. Tente novamente ou abra o link no VLC pela biblioteca.',
              )
            }
          >
            Seu navegador não oferece suporte à reprodução de vídeo.
          </video>
        )}
        {error && (
          <div role="alert" className="rounded-xl border bg-card p-6">
            <p className="mb-4 text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        )}
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          Use os controles do player para reproduzir, ajustar o volume e abrir em tela cheia. A
          reprodução depende dos formatos e codecs compatíveis com seu navegador.
        </p>
      </div>
    </main>
  );
}
