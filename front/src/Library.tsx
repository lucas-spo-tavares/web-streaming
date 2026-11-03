import { Link, Outlet, useMatch } from 'react-router';
import { VIDEO_ACCEPT } from '../../config/video.mjs';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  FileVideo2,
  Film,
  Loader2,
  LogOut,
  Plus,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  Trash2,
  Download,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { LibraryApi, StreamLink } from '@/lib/api';
import { useLibrary } from '@/lib/use-library';
import { UploadJob, type UploadState } from '@/lib/upload';

export function bytes(size: number) {
  if (size < 1024) return `${size} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  const i = Math.min(Math.floor(Math.log(size) / Math.log(1024)) - 1, 2);
  return `${(size / 1024 ** (i + 1)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[i]}`;
}
export function remaining(end: string, now: number) {
  const diff = Math.max(0, Date.parse(end) - now);
  if (!diff) return 'Expirado';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${Math.floor((diff % 3600000) / 60000)}min`;
  return `${Math.max(1, Math.ceil(diff / 60000))}min`;
}
const date = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export function Library({ api, logout }: { api: LibraryApi; logout: () => void }) {
  const isLibrary = useMatch('/') !== null;
  const [query, setQuery] = useState('');
  const library = useLibrary(api, query);
  const [, setClock] = useState(Date.now());
  const now = Date.now() + library.offset;
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState<(StreamLink & { name: string; key: string }) | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const busy = copying !== null || deleting !== null || renewing !== null || downloading !== null;
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
  function select(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const id = crypto.randomUUID();
      const job = new UploadJob(file, api, (state) => {
        setJobs((previous) => ({ ...previous, [id]: state }));
        if (state.status === 'complete') {
          jobRefs.current.delete(id);
          refresh.current();
        }
      });
      jobRefs.current.set(id, job);
      void job.run();
    }
    if (input.current) input.current.value = '';
  }
  async function copy(key: string, name: string) {
    setCopying(key);
    setNotice('');
    try {
      const result = await api.stream(key);
      setLink({ ...result, name, key });
      try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(result.url);
        setNotice(`Link de ${name} copiado. Abra no VLC em Mídia → Abrir fluxo de rede.`);
      } catch {
        setNotice('Link gerado. Selecione e copie o endereço abaixo para abrir no VLC.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao gerar link.');
    } finally {
      setCopying(null);
    }
  }
  async function renew(key: string, name: string) {
    if (busy) return;
    setRenewing(key);
    setNotice('');
    try {
      const result = await api.renew(key);
      setNotice(`Prazo de ${name} reiniciado. Nova expiração: ${date(result.file.expiresAt)}.`);
      library.refresh();
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
      const result = await api.download(key);
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
        `Excluir “${name}” permanentemente? Esta ação não pode ser desfeita. Links já gerados podem continuar disponíveis até expirar.`,
      )
    )
      return;
    setDeleting(key);
    setNotice('');
    try {
      await api.delete(key);
      setLink((current) => (current?.key === key ? null : current));
      setNotice(`${name} excluído.`);
      library.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao excluir arquivo.');
    } finally {
      setDeleting(null);
    }
  }
  return (
    <>
      <div hidden={!isLibrary} className="min-h-screen bg-background text-foreground">
        <header className="border-b border-white/10 bg-[#101b16] text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
            <Link
              to="/"
              aria-label="Acervo, início"
              className="flex items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
            >
              <span className="flex size-9 items-center justify-center rounded-lg border border-white/15 bg-white/5">
                <Film size={19} />
              </span>
              <span className="text-xl font-semibold tracking-tight">
                acervo<span className="text-emerald-300">.</span>
              </span>
            </Link>
            <div className="flex items-center gap-5">
              <span className="hidden items-center gap-2 text-xs text-white/55 sm:flex">
                <span className="size-1.5 rounded-full bg-emerald-300" />
                Biblioteca pessoal
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-white/75 hover:bg-white/10 hover:text-white"
                onClick={logout}
              >
                <LogOut />
                Sair
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <div className="mb-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <p className="mb-3 text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
                Seu espaço de vídeos
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Sua biblioteca</h1>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Guarde por um tempo. Assista de onde quiser.
                <br className="hidden sm:block" /> Assista no navegador ou gere um link para o VLC.
              </p>
            </div>
            <Button className="self-start sm:self-auto" onClick={() => input.current?.click()}>
              <Plus />
              Enviar arquivos
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
          <div className="mb-8 grid gap-4 border-y border-border py-5 text-sm sm:grid-cols-3">
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
          {Object.keys(jobs).length > 0 && (
            <section aria-label="Envios" className="mb-7 space-y-4 rounded-xl border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Upload className="size-4" />
                Seus envios
              </h2>
              {Object.entries(jobs).map(([id, job]) => (
                <div key={id} className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{job.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {bytes(job.size)} · {job.message ?? `${job.progress}%`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {job.status === 'error' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void jobRefs.current.get(id)?.run()}
                        >
                          Tentar novamente
                        </Button>
                      )}
                      {(job.status === 'sending' || job.status === 'error') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Cancelar envio de ${job.name}`}
                          onClick={() => void jobRefs.current.get(id)?.cancel()}
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
                          onClick={() => {
                            jobRefs.current.delete(id);
                            setJobs((current) => {
                              const next = { ...current };
                              delete next[id];
                              return next;
                            });
                          }}
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  </div>
                  <Progress value={job.progress} aria-label={`Progresso de ${job.name}`} />
                </div>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Arquivo</TableHead>
                    <TableHead className="hidden sm:table-cell">Tamanho</TableHead>
                    <TableHead className="hidden lg:table-cell">Adicionado em</TableHead>
                    <TableHead>Expira em</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {library.files.map((file) => {
                    const expired = now >= Date.parse(file.expiresAt);
                    return (
                      <TableRow key={file.key}>
                        <TableCell className="max-w-[135px] pl-5 sm:max-w-xs">
                          <div className="flex items-center gap-3">
                            <span className="hidden size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-primary sm:flex">
                              <FileVideo2 className="size-5" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium break-all sm:truncate" title={file.name}>
                                {file.name}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                                {bytes(file.size)}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs whitespace-nowrap text-muted-foreground sm:table-cell">
                          {bytes(file.size)}
                        </TableCell>
                        <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground lg:table-cell">
                          {date(file.createdAt)}
                        </TableCell>
                        <TableCell>
                          <span
                            title={date(file.expiresAt)}
                            className={`text-xs whitespace-nowrap ${expired ? 'text-muted-foreground' : 'text-primary'}`}
                          >
                            {remaining(file.expiresAt, now)}
                          </span>
                          {expired && (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Exclusão pendente
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {!expired && deleting !== file.key && (
                              <Button asChild variant="outline" size="sm" className="mr-1">
                                <Link
                                  to={`/watch/${encodeURIComponent(file.key)}`}
                                  aria-label={`Assistir ${file.name}`}
                                >
                                  <Play />
                                  <span className="hidden sm:inline">Assistir</span>
                                </Link>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={expired || busy}
                              aria-label={`Copiar link de ${file.name}`}
                              onClick={() => void copy(file.key, file.name)}
                            >
                              {copying === file.key ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <Copy />
                              )}
                              <span className="hidden sm:inline">Copiar link</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={expired || busy}
                              aria-label={`Baixar ${file.name}`}
                              onClick={() => void download(file.key, file.name)}
                            >
                              {downloading === file.key ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <Download />
                              )}
                              <span className="hidden sm:inline">Baixar</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              aria-label={`Reiniciar expiração de ${file.name}`}
                              onClick={() => void renew(file.key, file.name)}
                            >
                              {renewing === file.key ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <RotateCcw />
                              )}
                              <span className="hidden sm:inline">Reiniciar prazo</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-1 text-destructive hover:text-destructive"
                              disabled={busy}
                              aria-label={`Excluir ${file.name}`}
                              onClick={() => void remove(file.key, file.name)}
                            >
                              {deleting === file.key ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <Trash2 />
                              )}
                              <span className="hidden sm:inline">Excluir</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
            <div className="border-t bg-muted/30 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
              Reiniciar o prazo mantém o vídeo por mais 30 dias a partir de agora. Após a expiração,
              a limpeza automática remove o arquivo na próxima execução.
            </div>
          </section>
          <div role="status" aria-live="polite" className="mt-5 text-sm text-primary">
            {notice}
          </div>
          {link && (
            <section
              className="mt-4 rounded-xl border bg-card p-5"
              aria-label="Link para streaming"
            >
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
                Válido até {date(link.expiresAt)}. Quem receber este link pode acessar o vídeo até
                esse horário. O formato e os codecs precisam ser compatíveis com o VLC.
              </p>
            </section>
          )}
          <footer className="mt-10 flex flex-col justify-between gap-2 text-[11px] text-muted-foreground sm:flex-row">
            <span>Seu acervo, por tempo limitado.</span>
            <span>Vídeos originais · Links temporários</span>
          </footer>
        </main>
      </div>
      <Outlet />
    </>
  );
}
