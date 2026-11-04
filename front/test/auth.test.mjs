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
  assert.equal(stored.refreshToken, 'test-refresh');
  const restored = new AuthClient(config);
  assert.equal(await restored.token(), 'test-access');
  assert.equal(restored.snapshot().refreshToken, 'test-refresh');
});

test('expiration renews the access token using the expiry returned by Cognito', async () => {
  let now = 100000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { auth, commands } = await login(10);
  now += 9999;
  assert.equal(await auth.token(), 'test-access');
  now++;
  assert.equal(await auth.token(), 'test-access');
  assert.equal(auth.snapshot().expires, now + 10000);
  assert.deepEqual(commands, ['USER_AUTH', 'EMAIL_OTP', 'REFRESH_TOKEN_AUTH']);
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

test('reload refreshes even an expired access token using the persisted refresh token', async () => {
  let now = 100000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await login(10);
  now += 11000;
  const restored = new AuthClient(config);
  assert.ok(restored.snapshot());
  restored.client.send = async (command) => {
    assert.equal(command.input.AuthFlow, 'REFRESH_TOKEN_AUTH');
    assert.equal(command.input.AuthParameters.REFRESH_TOKEN, 'test-refresh');
    return { AuthenticationResult: { AccessToken: 'renewed', ExpiresIn: 900 } };
  };
  await restored.initialize();
  assert.equal(await restored.token(), 'renewed');
  assert.equal(restored.snapshot().refreshToken, 'test-refresh');
  assert.equal(JSON.parse(saved.get(key)).accessToken, 'renewed');
});

test('opening the application refreshes a still-valid access token', async () => {
  const { auth, commands } = await login();
  await auth.initialize();
  assert.deepEqual(commands, ['USER_AUTH', 'EMAIL_OTP', 'REFRESH_TOKEN_AUTH']);
});

test('simultaneous refresh requests share one Cognito call', async () => {
  const { auth } = await login();
  let resolveRefresh;
  const send = vi.fn(
    () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  );
  auth.client.send = send;
  const first = auth.refresh();
  const second = auth.refresh();
  const token = auth.token();
  resolveRefresh({ AuthenticationResult: { AccessToken: 'renewed', ExpiresIn: 900 } });
  assert.deepEqual(await Promise.all([first, second, token]), ['renewed', 'renewed', 'renewed']);
  assert.equal(send.mock.calls.length, 1);
});

test('a revoked refresh token clears the persisted session', async () => {
  const { auth } = await login();
  auth.client.send = async () => {
    throw Object.assign(new Error('Revoked'), { name: 'NotAuthorizedException' });
  };
  await assert.rejects(auth.refresh(), /Sua sessão terminou/);
  assert.equal(auth.snapshot(), null);
  assert.equal(saved.has(key), false);
});

test('temporary refresh failures preserve the session and allow another attempt', async () => {
  const { auth } = await login();
  auth.client.send = vi
    .fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ AuthenticationResult: { AccessToken: 'renewed', ExpiresIn: 900 } });
  await assert.rejects(auth.refresh(), /Não foi possível renovar/);
  assert.ok(auth.snapshot());
  assert.ok(saved.has(key));
  assert.equal(await auth.refresh(), 'renewed');
});

test('logout during refresh prevents a late response from restoring the session', async () => {
  const { auth } = await login();
  let resolveRefresh;
  auth.client.send = (command) =>
    command.input.AuthFlow === 'REFRESH_TOKEN_AUTH'
      ? new Promise((resolve) => {
          resolveRefresh = resolve;
        })
      : Promise.resolve({});
  const pending = auth.refresh();
  auth.logout();
  resolveRefresh({ AuthenticationResult: { AccessToken: 'renewed', ExpiresIn: 900 } });
  await assert.rejects(pending, /cancelada/);
  assert.equal(auth.snapshot(), null);
  assert.equal(saved.has(key), false);
});

test('restored sessions let Cognito decide whether the refresh token is still valid', async () => {
  let now = 100000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await login(900);
  now += 2 * 86400000;
  const restored = new AuthClient(config);
  assert.ok(restored.snapshot());
  restored.client.send = async () => ({
    AuthenticationResult: { AccessToken: 'renewed', ExpiresIn: 120 },
  });
  await restored.initialize();
  assert.equal(restored.snapshot().expires, now + 120000);
  assert.equal(await restored.token(), 'renewed');
});

test('each refresh uses its own ExpiresIn instead of a fixed frontend duration', async () => {
  let now = 100000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { auth } = await login(60);
  assert.equal(auth.snapshot().expires, now + 60000);
  now += 60000;
  auth.client.send = async () => ({
    AuthenticationResult: { AccessToken: 'renewed', ExpiresIn: 1800 },
  });
  await auth.token();
  assert.equal(auth.snapshot().expires, now + 1800000);
});
