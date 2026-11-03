import assert from 'node:assert/strict';
import { afterAll, afterEach, beforeEach, test, vi } from 'vitest';
import { AuthClient } from '../src/lib/auth.ts';
afterAll(() => {
  delete globalThis.localStorage;
});
afterEach(() => vi.restoreAllMocks());
const config = { clientId: 'test-client', region: 'sa-east-1', apiUrl: 'https://api.acervo.test' };
const key = 'acervo.session.sa-east-1.test-client';
let saved;
beforeEach(() => {
  saved = new Map();
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
});
async function login(expiresIn = 3600) {
  const auth = new AuthClient(config);
  const commands = [];
  auth.client.send = async (command) => {
    commands.push(command.input.AuthFlow ?? command.input.ChallengeName ?? 'revoke');
    return command.input.AuthFlow === 'USER_AUTH'
      ? { ChallengeName: 'EMAIL_OTP', Session: 'otp-session' }
      : {
          AuthenticationResult: {
            AccessToken: 'test-access',
            RefreshToken: 'test-refresh',
            ExpiresIn: expiresIn,
          },
        };
  };
  await auth.start('owner@acervo.test');
  await auth.confirm('12345678');
  return { auth, commands };
}

test('login persists access token and reload restores a valid session', async () => {
  const { auth } = await login();
  const stored = JSON.parse(saved.get(key));
  assert.equal(stored.accessToken, 'test-access');
  assert.equal(stored.expires, auth.snapshot().expires);
  assert.equal(stored.refreshToken, undefined);
  const restored = new AuthClient(config);
  assert.equal(await restored.token(), 'test-access');
  assert.equal(restored.snapshot().refreshToken, undefined);
});

test('expiration removes the persisted token without refreshing it', async () => {
  let now = 100000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { auth, commands } = await login(10);
  now += 9999;
  assert.equal(await auth.token(), 'test-access');
  now++;
  await assert.rejects(auth.token(), /Sua sessão terminou/);
  assert.equal(auth.snapshot(), null);
  assert.equal(saved.has(key), false);
  assert.deepEqual(commands, ['USER_AUTH', 'EMAIL_OTP']);
});

test('expired and malformed saved sessions are discarded on reload', () => {
  for (const raw of [
    'bad-json',
    'null',
    JSON.stringify({ accessToken: '', expires: Date.now() + 60000 }),
    JSON.stringify({ accessToken: 'expired', expires: Date.now() - 1 }),
  ]) {
    saved.set(key, raw);
    assert.equal(new AuthClient(config).snapshot(), null);
    assert.equal(saved.has(key), false);
  }
});

test('logout removes storage and synchronizes with another tab', async () => {
  const { auth } = await login();
  const secondTab = new AuthClient(config);
  auth.logout();
  assert.equal(auth.snapshot(), null);
  assert.equal(saved.has(key), false);
  secondTab.syncStorage({ key });
  assert.equal(secondTab.snapshot(), null);
});

test('sessions from another app client are not reused', async () => {
  await login();
  assert.equal(new AuthClient({ ...config, clientId: 'different-client' }).snapshot(), null);
  assert.equal(saved.has(key), true);
});
