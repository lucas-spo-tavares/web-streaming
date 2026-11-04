import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { AppConfig } from '@/config';

interface Session {
  accessToken: string;
  refreshToken?: string;
  expires: number;
}
interface Challenge {
  username: string;
  email: string;
  session: string;
  expires: number;
}

function message(error: unknown, confirming: boolean) {
  const name = error instanceof Error ? error.name : '';

  if (name === 'CodeMismatchException')
    return 'Código incorreto. Confira o email e tente novamente.';

  if (name === 'ExpiredCodeException') return 'O código expirou. Solicite um novo código.';

  if (
    [
      'TooManyRequestsException',
      'LimitExceededException',
      'TooManyFailedAttemptsException',
    ].includes(name)
  )
    return 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.';

  if (name === 'NotAuthorizedException' || name === 'UserNotFoundException')
    return confirming
      ? 'Código ou sessão inválidos. Solicite um novo código.'
      : 'Não foi possível iniciar o acesso com esse email.';

  return confirming
    ? 'Não foi possível confirmar o código. Tente novamente.'
    : 'Não foi possível enviar o código. Tente novamente.';
}

export class AuthClient {
  error = '';
  private session: Session | null = null;
  private challenge: Challenge | null = null;
  private listeners = new Set<() => void>();
  private readonly storageKey: string;
  private client: CognitoIdentityProviderClient;
  private generation = 0;
  constructor(private config: AppConfig) {
    this.client = new CognitoIdentityProviderClient({ region: config.region || 'sa-east-1' });
    this.storageKey = `acervo.session.${config.region}.${config.clientId}`;
    this.restore();
  }

  restore() {
    let restored: Session | null = null;

    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null');

      if (
        saved &&
        typeof saved.accessToken === 'string' &&
        saved.accessToken.trim().length > 0 &&
        Number.isFinite(saved.expires) &&
        saved.expires > Date.now()
      ) {
        restored = { accessToken: saved.accessToken, expires: saved.expires };
      } else {
        localStorage.removeItem(this.storageKey);
      }
    } catch {
      try {
        localStorage.removeItem(this.storageKey);
      } catch {
        /* Storage may be unavailable. */
      }
    }
    this.session = restored;
    this.emit();
  }

  syncStorage = (event: StorageEvent) => {
    if (event.key === this.storageKey || event.key === null) this.restore();
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.session;

  private emit() {
    for (const listener of this.listeners) listener();
  }

  clear(error = '') {
    this.error = error;
    this.generation++;
    this.session = null;
    this.challenge = null;

    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      /* Keep logout available without storage. */
    }
    this.emit();
  }

  cancelChallenge() {
    this.generation++;
    this.challenge = null;
  }

  async start(email: string) {
    const normalized = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254)
      throw new Error('Informe um email válido.');
    const generation = ++this.generation;
    this.challenge = null;
    let result;

    try {
      result = await this.client.send(
        new InitiateAuthCommand({
          ClientId: this.config.clientId,
          AuthFlow: 'USER_AUTH',
          AuthParameters: { USERNAME: normalized, PREFERRED_CHALLENGE: 'EMAIL_OTP' },
        }),
      );
    } catch (error) {
      throw new Error(message(error, false), { cause: error });
    }

    if (generation !== this.generation) throw new Error('Solicitação de login cancelada.');

    if (result.ChallengeName !== 'EMAIL_OTP' || !result.Session)
      throw new Error(
        'O acesso por código não está disponível. Confira a configuração do usuário e do Cognito.',
      );
    this.challenge = {
      email: normalized,
      username:
        result.ChallengeParameters?.USERNAME ??
        result.ChallengeParameters?.USER_ID_FOR_SRP ??
        normalized,
      session: result.Session,
      expires: Date.now() + 3 * 60 * 1000,
    };
  }

  async confirm(code: string) {
    const challenge = this.challenge;
    const generation = this.generation;

    if (!challenge || challenge.expires <= Date.now()) {
      this.challenge = null;
      throw new Error('A sessão expirou. Solicite um novo código.');
    }

    if (!/^\d{8}$/.test(code)) throw new Error('Informe os 8 dígitos do código.');
    let result;

    try {
      result = await this.client.send(
        new RespondToAuthChallengeCommand({
          ClientId: this.config.clientId,
          ChallengeName: 'EMAIL_OTP',
          Session: challenge.session,
          ChallengeResponses: { USERNAME: challenge.username, EMAIL_OTP_CODE: code },
        }),
      );
    } catch (error) {
      throw new Error(message(error, true), { cause: error });
    }

    if (generation !== this.generation || this.challenge !== challenge)
      throw new Error('Solicitação de login cancelada.');
    this.accept(result.AuthenticationResult);
    this.challenge = null;
  }

  private accept(tokens?: AuthenticationResultType) {
    if (!tokens?.AccessToken || !Number.isFinite(tokens.ExpiresIn) || tokens.ExpiresIn! <= 0)
      throw new Error('Resposta de autenticação inválida.');
    this.error = '';
    this.session = {
      accessToken: tokens.AccessToken,
      refreshToken: tokens.RefreshToken,
      expires: Date.now() + tokens.ExpiresIn! * 1000,
    };

    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          accessToken: this.session.accessToken,
          expires: this.session.expires,
        }),
      );
    } catch {
      /* A valid login still works in memory when storage is unavailable. */
    }
    this.emit();

    return tokens.AccessToken;
  }

  async token(): Promise<string> {
    const current = this.session;

    if (!current) throw new Error('Entre para continuar.');

    if (current.expires <= Date.now()) {
      this.clear('Sua sessão terminou. Entre novamente.');
      throw new Error(this.error);
    }

    return current.accessToken;
  }

  logout() {
    const refreshToken = this.session?.refreshToken;
    this.clear();

    if (refreshToken)
      void this.client
        .send(new RevokeTokenCommand({ ClientId: this.config.clientId, Token: refreshToken }))
        .catch(() => {});
  }
}
