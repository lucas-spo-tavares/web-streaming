import { Link } from 'react-router';
import { FileActionsMenu } from './FileActionsMenu';
import {
  Copy,
  Download,
  FileVideo2,
  Link2,
  Loader2,
  Play,
  RotateCcw,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { VideoFile } from '@/services/types';

interface LibraryTableProps {
  files: VideoFile[];
  now: number;
  busy: boolean;
  copying: string | null;
  shortening: string | null;
  downloading: string | null;
  renewing: string | null;
  deleting: string | null;
  copy: (key: string, name: string, short?: boolean) => Promise<boolean>;
  fixed: (key: string, name: string) => void;
  download: (key: string, name: string) => Promise<void>;
  renew: (key: string, name: string) => Promise<void>;
  remove: (key: string, name: string) => Promise<void>;
}

export function LibraryTable({
  files,
  now,
  busy,
  copying,
  shortening,
  downloading,
  renewing,
  deleting,
  copy,
  fixed,
  download,
  renew,
  remove,
}: LibraryTableProps) {
  return (
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
        {files.map((file) => {
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
                      {file.size.appBytesFormat()}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden font-mono text-xs whitespace-nowrap text-muted-foreground sm:table-cell">
                {file.size.appBytesFormat()}
              </TableCell>
              <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground lg:table-cell">
                {new Date(file.createdAt).appDateFormat()}
              </TableCell>
              <TableCell>
                <span
                  title={new Date(file.expiresAt).appDateFormat()}
                  className={`text-xs whitespace-nowrap ${expired ? 'text-muted-foreground' : 'text-primary'}`}
                >
                  {new Date(file.expiresAt).appRemainingTime({ now })}
                </span>
                {expired && (
                  <p className="mt-1 text-[10px] text-muted-foreground">Exclusão pendente</p>
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
                    aria-label={`Gerar link fixo de ${file.name}`}
                    onClick={() => fixed(file.key, file.name)}
                  >
                    <Link2 />
                    <span className="hidden sm:inline">Link fixo</span>
                  </Button>
                  <FileActionsMenu name={file.name} busy={busy}>
                    <Button
                      role="menuitem"
                      variant="ghost"
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
                      <span>Baixar</span>
                    </Button>
                    <Button
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Reiniciar expiração de ${file.name}`}
                      onClick={() => void renew(file.key, file.name)}
                    >
                      {renewing === file.key ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                      <span>Reiniciar prazo</span>
                    </Button>
                    <Button
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      disabled={expired || busy}
                      aria-label={`Copiar link de ${file.name}`}
                      onClick={() => void copy(file.key, file.name)}
                    >
                      {copying === file.key ? <Loader2 className="animate-spin" /> : <Copy />}
                      <span>Copiar link</span>
                    </Button>
                    <Button
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      disabled={expired || busy}
                      aria-label={`Gerar link aleatório de ${file.name}`}
                      onClick={() => void copy(file.key, file.name, true)}
                    >
                      {shortening === file.key ? <Loader2 className="animate-spin" /> : <Shuffle />}
                      <span>Gerar link aleatório</span>
                    </Button>
                    <Button
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      aria-label={`Excluir ${file.name}`}
                      onClick={() => void remove(file.key, file.name)}
                    >
                      {deleting === file.key ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      <span>Excluir</span>
                    </Button>
                  </FileActionsMenu>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
