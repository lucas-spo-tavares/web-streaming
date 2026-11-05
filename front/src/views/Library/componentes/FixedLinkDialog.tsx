import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FixedLinkDialogProps {
  name: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onGenerate: (code: string) => Promise<void>;
}

export function FixedLinkDialog({ name, busy, error, onClose, onGenerate }: FixedLinkDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState('stream');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="fixed-link-title"
      aria-describedby="fixed-link-description"
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/60"
      onCancel={(event) => {
        event.preventDefault();

        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();

          if (!busy) void onGenerate(code);
        }}
      >
        <h2 id="fixed-link-title" className="text-lg font-semibold">
          Gerar link fixo
        </h2>
        <p id="fixed-link-description" className="mt-2 text-sm text-muted-foreground">
          Escolha o endereço de {name}. Se ele já for seu, o destino será substituído por este
          vídeo. O link vale por até 4 horas, com no máximo 5 acessos.
        </p>
        <Label htmlFor="fixed-link-code" className="mt-5 mb-2 block">
          Código do link fixo
        </Label>
        <Input
          id="fixed-link-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          maxLength={64}
          pattern="[a-z0-9][a-z0-9_\-]{0,63}"
          title="Use de 1 a 64 letras minúsculas, números, hífens ou sublinhados, começando por letra ou número."
          disabled={busy}
          autoFocus
        />
        <p className="mt-2 text-xs break-all text-muted-foreground">
          https://link.lucas-tavares.com/{code}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(code)}>
            {busy && <Loader2 className="animate-spin" />}
            Gerar link fixo
          </Button>
        </div>
      </form>
    </dialog>
  );
}
