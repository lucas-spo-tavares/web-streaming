import { LibraryTable } from './componentes/LibraryTable';
import { UploadItem } from './componentes/UploadItem';
import { FileDrop } from './componentes/FileDrop';
import { FixedLinkDialog } from './componentes/FixedLinkDialog';
import { useUploadJob } from '@/server-state/uploads';
import { useCreateStreamLink, useCreateShortLink } from '@/server-state/stream-links';
import { useDownloadLink } from '@/server-state/download-links';
import { Outlet, useMatch } from 'react-router';
import { VIDEO_ACCEPT } from '../../../../config/video.ts';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  FileVideo2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { StreamLink } from '@/services/types';
import { useLibrary, useRenewFile, useDeleteFile } from '@/server-state/files';
import { UploadJob, type UploadState } from '@/lib/upload';

export function Library() {
  const uploadJob = useUploadJob();
  const renewFile = useRenewFile();
  const deleteFile = useDeleteFile();
  const streamLink = useCreateStreamLink();
  const shortLink = useCreateShortLink();
  const getDownloadLink = useDownloadLink();
  const isLibrary = useMatch('/') !== null;
  const [query, setQuery] = useState('');
  const library = useLibrary(query);
  const [, setClock] = useState(Date.now());
  const now = Date.now() + library.offset;
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState<(StreamLink & { name: string; key: string }) | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [shortening, setShortening] = useState<string | null>(null);
  const [fixedLink, setFixedLink] = useState<{ key: string; name: string } | null>(null);
  const busy =
    shortening !== null ||
    copying !== null ||
    deleting !== null ||
    renewing !== null ||
    downloading !== null;
  const [jobs, setJobs] = useState<Record<string, UploadState>>({});
  const jobRefs = useRef(new Map<string, UploadJob>());
  const input = useRef<HTMLInputElement>(null);
  const refresh = useRef(library.refresh);
  refresh.current = library.refresh;
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 10000);

    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const active = jobRefs.current;

    return () => {
      for (const job of active.values()) void job.cancel();
      active.clear();
    };
  }, []);

  function select(files: FileList | File[] | null) {
    for (const file of Array.from(files ?? [])) {
      const id = crypto.randomUUID();
      const job = new UploadJob(file, (state) => {
        setJobs((previous) => ({ ...previous, [id]: state }));

        if (state.status === 'complete') {
          jobRefs.current.delete(id);
          refresh.current();
        }
      });
      jobRefs.current.set(id, job);
      uploadJob.mutate(job);
    }

    if (input.current) input.current.value = '';
  }

  async function copy(key: string, name: string, short = false, code?: string) {
    if (busy) return false;

    if (short) setShortening(key);
    else setCopying(key);
    setNotice('');

    try {
      const result = short
        ? await shortLink.mutateAsync({ key, code })
        : await streamLink.mutateAsync(key);
      setLink({ ...result, name, key });

      try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(result.url);
        setNotice(`Link de ${name} copiado. Abra no VLC em Mídia → Abrir fluxo de rede.`);
      } catch {
        setNotice('Link gerado. Selecione e copie o endereço abaixo para abrir no VLC.');
      }

      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao gerar link.');

      return false;
    } finally {
      setCopying(null);
      setShortening(null);
    }
  }

  async function renew(key: string, name: string) {
    if (busy) return;
    setRenewing(key);
    setNotice('');

    try {
      const result = await renewFile.mutateAsync(key);
      setNotice(
        `Prazo de ${name} reiniciado. Nova expiração: ${new Date(result.file.expiresAt).appDateFormat()}.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao reiniciar o prazo.');
    } finally {
      setRenewing(null);
    }
  }

  async function download(key: string, name: string) {
    if (busy) return;
    setDownloading(key);
    setNotice('');

    try {
      const result = await getDownloadLink(key);
      const anchor = document.createElement('a');
      anchor.href = result.url;
      anchor.download = name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setNotice(`Download de ${name} iniciado.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao preparar o download.');
    } finally {
      setDownloading(null);
    }
  }

  async function remove(key: string, name: string) {
    if (busy) return;

    if (
      !window.confirm(
        `Excluir “${name}” e suas legendas permanentemente? Esta ação não pode ser desfeita. Links já gerados podem continuar disponíveis até expirar.`,
      )
    )
      return;
    setDeleting(key);
    setNotice('');

    try {
      await deleteFile.mutateAsync(key);
      setLink((current) => (current?.key === key ? null : current));
      setNotice(`${name} excluído.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao excluir arquivo.');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      {isLibrary && <FileDrop onFiles={select} onReject={setNotice} />}
      <div hidden={!isLibrary}>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-5 border-y border-border py-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-4 text-primary" />
              <span className="text-muted-foreground">
                Acesso <strong className="font-medium text-foreground">privado</strong>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg leading-none text-primary">↗</span>
              <span className="text-muted-foreground">
                Links por até <strong className="font-medium text-foreground">4 horas</strong>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="size-4 rounded-full border border-primary text-center text-[10px] leading-[14px] text-primary">
                ↻
              </span>
              <span className="text-muted-foreground">
                Retenção de <strong className="font-medium text-foreground">30 dias</strong>
              </span>
            </div>
          </div>
          <Button className="shrink-0" onClick={() => input.current?.click()}>
            <Plus />
            Enviar vídeos
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={VIDEO_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Selecionar vídeos para enviar"
            onChange={(event) => select(event.target.files)}
          />
        </div>
        {Object.keys(jobs).length > 0 && (
          <section aria-label="Envios" className="mb-7 space-y-4 rounded-xl border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Upload className="size-4" />
              Seus envios
            </h2>
            {Object.entries(jobs).map(([id, job]) => (
              <UploadItem
                key={id}
                job={job}
                onRetry={() => {
                  const job = jobRefs.current.get(id);

                  if (job) uploadJob.mutate(job);
                }}
                onCancel={() => void jobRefs.current.get(id)?.cancel()}
                onDismiss={() => {
                  jobRefs.current.delete(id);
                  setJobs((current) => {
                    const next = { ...current };
                    delete next[id];

                    return next;
                  });
                }}
              />
            ))}
          </section>
        )}
        <section
          aria-label="Arquivos"
          className="overflow-hidden rounded-xl border border-border bg-card shadow-xs"
        >
          <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold">Todos os arquivos</h2>
              <Badge className="border-border bg-muted font-mono text-muted-foreground">
                {library.files.length} carregados
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Label htmlFor="search" className="sr-only">
                  Buscar arquivos pelo nome
                </Label>
                <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
                <Input
                  id="search"
                  type="search"
                  placeholder="Buscar pelo nome…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Atualizar biblioteca"
                onClick={library.refresh}
              >
                <RefreshCw className={library.loading ? 'animate-spin' : ''} />
              </Button>
            </div>
          </div>
          {library.files.length > 0 && (
            <LibraryTable
              files={library.files}
              now={now}
              busy={busy}
              copying={copying}
              shortening={shortening}
              downloading={downloading}
              renewing={renewing}
              deleting={deleting}
              copy={copy}
              fixed={(key, name) => {
                setNotice('');
                setFixedLink({ key, name });
              }}
              download={download}
              renew={renew}
              remove={remove}
            />
          )}
          {library.loading && (
            <div
              role="status"
              className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" />
              {query ? 'Buscando em toda a biblioteca…' : 'Carregando arquivos…'}
            </div>
          )}
          {library.error && (
            <div role="alert" className="p-8 text-center">
              <p className="mb-3 text-sm text-destructive">{library.error}</p>
              <Button variant="outline" size="sm" onClick={library.more}>
                Tentar novamente
              </Button>
            </div>
          )}
          {!library.loading && !library.error && !library.files.length && (
            <div className="px-5 py-20 text-center">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border bg-muted/50">
                <FileVideo2 className="size-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-medium">
                {query ? 'Nenhum arquivo encontrado' : 'Sua biblioteca começa aqui'}
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {query
                  ? 'Tente buscar por outra parte do nome do arquivo.'
                  : 'Envie seu primeiro vídeo e gere um link para assistir no VLC.'}
              </p>
              {!query && (
                <Button variant="outline" className="mt-5" onClick={() => input.current?.click()}>
                  <Plus />
                  Enviar primeiro arquivo
                </Button>
              )}
            </div>
          )}
          {!library.loading && library.nextCursor && (
            <div className="border-t p-4 text-center">
              <Button variant="ghost" size="sm" onClick={library.more}>
                Carregar mais arquivos
                <ArrowUpRight />
              </Button>
            </div>
          )}
        </section>
        <div role="status" aria-live="polite" className="mt-5 text-sm text-primary">
          {notice}
        </div>
        {link && (
          <section className="mt-4 rounded-xl border bg-card p-5" aria-label="Link para streaming">
            <Label htmlFor="stream-url" className="mb-3 block">
              Link de {link.name}
            </Label>
            <Input
              id="stream-url"
              readOnly
              value={link.url}
              onFocus={(e) => e.target.select()}
              className="font-mono text-xs"
            />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Válido até {new Date(link.expiresAt).appDateFormat()}. Quem receber este link pode
              acessar o vídeo até esse horário. O formato e os codecs precisam ser compatíveis com o
              VLC.
            </p>
          </section>
        )}
      </div>
      <Outlet />
      {fixedLink && (
        <FixedLinkDialog
          name={fixedLink.name}
          busy={busy}
          error={notice}
          onClose={() => setFixedLink(null)}
          onGenerate={async (code) => {
            if (await copy(fixedLink.key, fixedLink.name, true, code)) setFixedLink(null);
          }}
        />
      )}
    </>
  );
}
