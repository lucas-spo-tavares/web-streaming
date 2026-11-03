import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Player } from './Player';
import { Film, ArrowUpRight, ShieldCheck, Mail, ArrowLeft } from 'lucide-react';
import { config, isConfigured } from './config';
import { AuthClient } from './lib/auth';
import { createApi } from './lib/api';
import { Library } from './Library';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
const auth = new AuthClient(config);
export default function App() {
  const session = useSyncExternalStore(auth.subscribe, auth.snapshot);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const api = useMemo(
    () =>
      createApi(
        () => auth.token(),
        () => {
          auth.clear();
          resetLogin();
          setError('Sua sessão terminou. Entre novamente.');
        },
      ),
    [],
  );
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    window.addEventListener('storage', auth.syncStorage);
    return () => window.removeEventListener('storage', auth.syncStorage);
  }, []);
  useEffect(() => {
    if (!session) return;
    const checkExpiry = () => {
      if (session.expires > Date.now()) return;
      void auth.token().catch(() => {
        resetLogin();
        setError('Sua sessão terminou. Entre novamente.');
      });
    };
    const timer = setTimeout(checkExpiry, Math.max(0, session.expires - Date.now()));
    window.addEventListener('focus', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', checkExpiry);
      document.removeEventListener('visibilitychange', checkExpiry);
    };
  }, [session]);
  function resetLogin() {
    auth.cancelChallenge();
    setStep('email');
    setCode('');
    setError('');
    setNotice('');
  }
  if (session)
    return (
      <Routes>
        <Route
          element={
            <Library
              api={api}
              logout={() => {
                auth.logout();
                resetLogin();
              }}
            />
          }
        >
          <Route index element={null} />
          <Route path="watch/:fileName" element={<Player api={api} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    if (working || Date.now() < resendAt) return;
    setError('');
    setNotice('');
    setWorking(true);
    try {
      await auth.start(email);
      setEmail(email.trim().toLowerCase());
      setCode('');
      setStep('otp');
      setResendAt(Date.now() + 60000);
      setClock(Date.now());
      setNotice('Se o email estiver habilitado, você receberá um código de acesso.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível enviar o código.');
    } finally {
      setWorking(false);
    }
  }
  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    setError('');
    setWorking(true);
    try {
      await auth.confirm(code);
      setCode('');
      setStep('email');
      setResendAt(0);
      setNotice('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível confirmar o código.');
    } finally {
      setWorking(false);
    }
  }
  const resendSeconds = Math.max(0, Math.ceil((resendAt - clock) / 1000));
  return (
    <main className="grid min-h-screen bg-[#101b16] text-white lg:grid-cols-2">
      <section className="hidden flex-col justify-between px-7 py-9 sm:px-14 lg:flex lg:min-h-screen lg:p-16">
        <div className="flex items-center gap-3 text-xl font-semibold">
          <Film className="size-6 text-emerald-300" />
          acervo.
        </div>
        <div className="py-20 lg:py-0">
          <p className="mb-6 text-xs tracking-[0.23em] text-emerald-300/80 uppercase">
            Sua biblioteca pessoal
          </p>
          <h1 className="max-w-lg text-5xl leading-[1.1] font-medium tracking-tight sm:text-6xl">
            Seus vídeos.
            <br />
            <span className="text-emerald-200/70">Onde você estiver.</span>
          </h1>
          <p className="mt-7 max-w-sm text-sm leading-7 text-white/55">
            Um lugar simples para guardar seus vídeos e gerar links temporários para assistir no VLC
            ou no navegador.
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs text-white/50">
          <ShieldCheck className="size-4" />
          Acesso exclusivo do proprietário
        </p>
      </section>
      <section className="flex items-center justify-center bg-background px-7 py-16 text-foreground sm:px-14">
        <div className="w-full max-w-sm">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            Bem-vindo ao acervo
          </p>
          <h2 className="text-3xl font-semibold tracking-tight">
            Seu próximo play
            <br />
            começa aqui.
          </h2>
          <p className="mt-4 mb-8 text-sm leading-6 text-muted-foreground">
            Receba um código no seu email para acessar sua biblioteca. Não precisa de senha.
          </p>
          {step === 'email' ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Seu email</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="voce@exemplo.com"
                  disabled={working || !isConfigured}
                />
              </div>
              <Button
                type="submit"
                className="w-full justify-between"
                disabled={working || !isConfigured || resendSeconds > 0}
              >
                {working
                  ? 'Enviando código…'
                  : resendSeconds > 0
                    ? `Aguarde ${resendSeconds}s para reenviar`
                    : 'Receber código por email'}
                <Mail />
              </Button>
            </form>
          ) : (
            <form onSubmit={confirmCode} className="space-y-4">
              <p className="text-sm break-all text-muted-foreground">
                Código de acesso para <strong className="text-foreground">{email}</strong>
              </p>
              <div className="space-y-2">
                <Label htmlFor="login-code">Código de 8 dígitos</Label>
                <Input
                  id="login-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  pattern="[0-9]{8}"
                  maxLength={8}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="h-12 text-center font-mono text-xl tracking-[0.3em]"
                  placeholder="00000000"
                  disabled={working}
                  aria-describedby="otp-help"
                />
                <p id="otp-help" className="text-xs leading-5 text-muted-foreground">
                  Confira sua caixa de entrada e a pasta de spam. O código tem validade limitada.
                </p>
              </div>
              <Button
                type="submit"
                className="w-full justify-between"
                disabled={working || code.length !== 8}
              >
                {working ? 'Confirmando…' : 'Confirmar e entrar'}
                <ArrowUpRight />
              </Button>
              <div className="flex flex-wrap justify-between gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={working}
                  onClick={resetLogin}
                >
                  <ArrowLeft />
                  Trocar email
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={working || resendSeconds > 0}
                  onClick={() => void sendCode()}
                >
                  {resendSeconds > 0 ? `Reenviar em ${resendSeconds}s` : 'Reenviar código'}
                </Button>
              </div>
            </form>
          )}
          {notice && (
            <p role="status" className="mt-4 text-sm text-primary">
              {notice}
            </p>
          )}
          {!isConfigured && (
            <p role="status" className="mt-4 text-sm leading-6 text-muted-foreground">
              O acesso estará disponível após a configuração do ambiente.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-10 border-t pt-5 text-xs leading-6 text-muted-foreground">
            Armazenamento privado.
            <br />
            Links por até 4 horas. Arquivos por 30 dias.
          </div>
        </div>
      </section>
    </main>
  );
}
