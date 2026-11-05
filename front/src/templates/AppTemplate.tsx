import { Film, LogOut } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';

export function AppTemplate({ logout }: { logout: () => void }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-[#101b16] text-white">
        <div className="mx-auto flex max-w-[96rem] items-center justify-between px-5 py-5 sm:px-8">
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
      </header>
      <main className="mx-auto max-w-[96rem] px-5 py-10 sm:px-8 sm:py-14">
        <Outlet />
      </main>
    </div>
  );
}
