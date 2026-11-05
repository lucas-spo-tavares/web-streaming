import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function FileActionsMenu({
  name,
  busy,
  children,
}: {
  name: string;
  busy: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!position) return;
    const element = menu.current;
    const rect = element?.getBoundingClientRect();

    if (element && rect && rect.bottom > window.innerHeight - 8)
      element.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    element?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();

    function dismiss(event: PointerEvent) {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setPosition(null);
    }

    function close() {
      setPosition(null);
    }
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);

    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [position]);

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        aria-label={`Mais ações de ${name}`}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-controls={position ? id : undefined}
        disabled={busy}
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect();
          setPosition(
            position
              ? null
              : { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) },
          );
        }}
      >
        <Ellipsis />
      </Button>
      {position &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={`Ações de ${name}`}
            className="fixed z-50 flex w-56 max-w-[calc(100vw-1rem)] flex-col gap-1 rounded-lg border bg-card p-1 text-foreground shadow-lg [&>button]:justify-start"
            style={position}
            onClick={(event) => {
              const button = (event.target as HTMLElement).closest('button');

              if (button && !button.disabled) {
                setPosition(null);
                trigger.current?.focus();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                setPosition(null);

                if (event.key === 'Escape') {
                  event.preventDefault();
                  trigger.current?.focus();
                }

                return;
              }

              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = Array.from(
                menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              );
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                      items.length;
              items[next]?.focus();
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
