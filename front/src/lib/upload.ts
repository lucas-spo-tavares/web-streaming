import { start, parts as getParts, complete, abort } from '@/services/uploads';
import { videoContentType } from '../../../config/video.ts';
import { ApiError, type UploadSession } from '@/services/types';

const MAX_UPLOAD_BYTES = 20 * 1024 ** 3;

export type UploadState = {
  name: string;
  size: number;
  progress: number;
  status: 'sending' | 'error' | 'complete' | 'cancelled';
  message?: string;
};

export type Transfer = (
  url: string,
  blob: Blob,
  signal: AbortSignal,
  progress: (bytes: number) => void,
) => Promise<string>;

export const transferPart: Transfer = (url, blob, signal, progress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener('abort', abort);
    xhr.open('PUT', url);
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = (event) => progress(event.loaded);
    xhr.onload = () => {
      cleanup();
      const etag = xhr.getResponseHeader('ETag');

      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new Error('Falha ao enviar parte. Verifique a conexão e tente novamente.'));
    };
    xhr.onerror = xhr.ontimeout = () => {
      cleanup();
      reject(new Error('Conexão interrompida durante o envio.'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Envio interrompido', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });

    if (signal.aborted) {
      cleanup();
      reject(new DOMException('Envio interrompido', 'AbortError'));

      return;
    }
    xhr.send(blob);
  });

export class UploadJob {
  private session?: UploadSession;
  private completed = new Map<number, string>();
  private sent = new Map<number, number>();
  private controller = new AbortController();
  private running = false;
  private cancelled = false;
  constructor(
    readonly file: File,
    private notify: (state: UploadState) => void,
    private transfer: Transfer = transferPart,
  ) {}
  private update(status: UploadState['status'], message?: string) {
    const total = [...this.sent.values()].reduce((sum, n) => sum + n, 0);
    this.notify({
      name: this.file.name,
      size: this.file.size,
      progress:
        status === 'complete' ? 100 : Math.min(99, Math.round((total / this.file.size) * 100)) || 0,
      status,
      message,
    });
  }
  async run() {
    if (this.running || this.cancelled) return;

    if (!videoContentType(this.file.name, this.file.type)) {
      this.update('error', 'Envie apenas arquivos de vídeo com extensão e tipo compatíveis.');

      return;
    }

    if (this.file.size < 1 || this.file.size > MAX_UPLOAD_BYTES) {
      this.update(
        'error',
        `Selecione um arquivo de até ${MAX_UPLOAD_BYTES.appBytesFormat()}, com tamanho maior que zero.`,
      );

      return;
    }
    this.running = true;
    this.controller = new AbortController();
    this.update('sending');

    try {
      this.session ??= await start(this.file);

      if (this.cancelled) {
        await abort(this.session.ticket);

        return;
      }
      const session = this.session;
      let index = 1;
      let failure: unknown;
      const worker = async () => {
        while (!failure && !this.controller.signal.aborted && index <= session.partCount) {
          const number = index++;

          if (this.completed.has(number)) continue;

          try {
            // Signing just before each part renews expired URLs on every retry.
            const { parts } = await getParts(session.ticket, [number]);
            const blob = this.file.slice(
              (number - 1) * session.partSize,
              number * session.partSize,
            );
            const etag = await this.transfer(
              parts[0].url,
              blob,
              this.controller.signal,
              (bytes) => {
                this.sent.set(number, bytes);
                this.update('sending');
              },
            );
            this.completed.set(number, etag);
            this.sent.set(number, blob.size);
          } catch (error) {
            failure = error;
            this.sent.delete(number);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, session.partCount) }, worker));

      if (failure) throw failure;

      if (this.cancelled) return;
      await complete(
        session.ticket,
        [...this.completed]
          .map(([partNumber, etag]) => ({ partNumber, etag }))
          .sort((a, b) => a.partNumber - b.partNumber),
      );

      if (!this.cancelled) this.update('complete', 'Arquivo enviado.');
    } catch (error) {
      if (!this.cancelled) {
        if (error instanceof ApiError && error.code === 'UPLOAD_EXPIRED') {
          this.session = undefined;
          this.completed.clear();
          this.sent.clear();
        }
        this.update(
          'error',
          error instanceof Error ? error.message : 'Falha no envio. Tente novamente.',
        );
      }
    } finally {
      this.running = false;
    }
  }
  async cancel() {
    this.cancelled = true;
    this.controller.abort();
    this.update('cancelled', 'Envio cancelado.');

    if (this.session) {
      try {
        await abort(this.session.ticket);
      } catch {
        this.update(
          'cancelled',
          'Envio interrompido. Partes pendentes serão removidas automaticamente.',
        );
      }
    }
  }
}
