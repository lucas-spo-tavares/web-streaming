import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shortenLink } from '@/short-links';
import { handleRequest } from '@/handler';
import { shorten as shortenUrl, signStream, mediaDomain } from '@/aws';
import * as s3Repository from '@/repository/s3';

vi.mock('@/aws');
vi.mock('@/repository/s3');

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(timestamp);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const key = '12345678-1234-4123-8123-123456789abc/video.mp4';
const timestamp = Date.now();
function fixture() {
  const shorten = vi.mocked(shortenUrl).mockResolvedValue('https://link.lucas-tavares.com/abcdef');
  vi.mocked(signStream).mockResolvedValue('https://media.test/signed');
  vi.mocked(mediaDomain).mockReturnValue('media.test');
  vi.mocked(s3Repository.head).mockResolvedValue({ key, size: 100, created: new Date(timestamp) });
  const event = (
    routeKey = 'POST /short-links',
    claims: object = { sub: 'owner', token_use: 'access', 'cognito:groups': 'owners' },
    body: object = { key },
  ) => ({
    routeKey,
    body: JSON.stringify(body),
    requestContext: { requestId: 'short-test', authorizer: { jwt: { claims } } },
  });
  return { event, shorten };
}
describe('short links', () => {
  it('preserves expiry and only shortens on the explicit short route', async () => {
    const { event, shorten } = fixture();
    const regular = await handleRequest(event('POST /stream-links') as never, undefined, () => {});
    expect(regular.statusCode).toBe(200);
    expect(shorten).not.toHaveBeenCalled();
    const short = await handleRequest(event() as never, undefined, () => {});
    expect(short.statusCode).toBe(200);
    expect(shorten).toHaveBeenCalledExactlyOnceWith(
      'https://media.test/signed',
      JSON.parse(regular.body).expiresAt,
      undefined,
    );
    expect(Date.parse(JSON.parse(short.body).expiresAt) - Math.floor(timestamp / 1000) * 1000).toBe(
      4 * 60 * 60 * 1000,
    );
    expect(JSON.parse(short.body)).toEqual({
      ...JSON.parse(regular.body),
      url: 'https://link.lucas-tavares.com/abcdef',
    });
  });
  it('rejects missing authorization and arbitrary URLs before shortening', async () => {
    const { event, shorten } = fixture();
    expect(
      (await handleRequest(event('POST /short-links', {}) as never, undefined, () => {}))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await handleRequest(
          event('POST /short-links', { sub: 'other', token_use: 'access' }) as never,
          undefined,
          () => {},
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await handleRequest(
          event('POST /short-links', undefined, { key, url: 'https://other.test' }) as never,
          undefined,
          () => {},
        )
      ).statusCode,
    ).toBe(400);
    expect(shorten).not.toHaveBeenCalled();
  });
  it('forwards a chosen code and rejects invalid codes before signing or shortening', async () => {
    const { event, shorten } = fixture();
    const result = await handleRequest(
      event('POST /short-links', undefined, { key, code: 'stream' }) as never,
      undefined,
      () => {},
    );
    expect(result.statusCode).toBe(200);
    expect(shorten).toHaveBeenCalledWith(
      'https://media.test/signed',
      JSON.parse(result.body).expiresAt,
      'stream',
    );
    for (const code of ['', 'Stream', '../stream', 'a'.repeat(65), null, 123]) {
      expect(
        (
          await handleRequest(
            event('POST /short-links', undefined, { key, code }) as never,
            undefined,
            () => {},
          )
        ).statusCode,
      ).toBe(400);
    }
    expect(shorten).toHaveBeenCalledOnce();
    expect(signStream).toHaveBeenCalledOnce();
  });
  it('limits short link expiry to the remaining file retention', async () => {
    const { event, shorten } = fixture();
    const expiry = Math.floor((timestamp + 60000) / 1000) * 1000;
    vi.mocked(s3Repository.head).mockResolvedValue({
      key,
      size: 100,
      created: new Date(timestamp),
      expires: new Date(expiry),
    });
    const result = await handleRequest(event() as never, undefined, () => {});
    expect(JSON.parse(result.body).expiresAt).toBe(new Date(expiry).toISOString());
    expect(shorten).toHaveBeenCalledWith(
      'https://media.test/signed',
      new Date(expiry).toISOString(),
      undefined,
    );
  });
  it('does not shorten expired or missing files', async () => {
    const { event, shorten } = fixture();
    vi.mocked(s3Repository.head)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ key, size: 1, created: new Date(timestamp - 31 * 86400000) });
    expect((await handleRequest(event() as never, undefined, () => {})).statusCode).toBe(404);
    expect((await handleRequest(event() as never, undefined, () => {})).statusCode).toBe(410);
    expect(shorten).not.toHaveBeenCalled();
  });
  it('sends the signed URL and server key using the documented contract', async () => {
    const expiresAt = new Date(timestamp + 4 * 60 * 60 * 1000).toISOString();
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ shortUrl: 'https://link.lucas-tavares.com/abcdef' }), {
          status: 201,
        }),
    );
    expect(await shortenLink('https://media.test/signed', 'test-key', { expiresAt }, request)).toBe(
      'https://link.lucas-tavares.com/abcdef',
    );
    expect(request).toHaveBeenCalledWith(
      'https://link.lucas-tavares.com/links',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
        body: JSON.stringify({ url: 'https://media.test/signed', expiresAt }),
      }),
    );
  });
  it('sends the fixed code and reports an unavailable code without exposing details', async () => {
    const options = { code: 'stream', expiresAt: new Date(timestamp + 14400000).toISOString() };
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ shortUrl: 'https://link.lucas-tavares.com/stream' })),
    );
    expect(await shortenLink('https://media.test/signed', 'test-key', options, request)).toBe(
      'https://link.lucas-tavares.com/stream',
    );
    expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toEqual({
      url: 'https://media.test/signed',
      ...options,
    });
    await expect(
      shortenLink(
        'https://media.test/signed',
        'test-key',
        options,
        async () => new Response('private diagnostic', { status: 403 }),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'SHORT_LINK_CODE_UNAVAILABLE' });
  });
  it.each([
    new Response('private diagnostic', { status: 401 }),
    new Response('{bad'),
    new Response(JSON.stringify({ shortUrl: 'https://other.test/code' })),
  ])('normalizes upstream failures without exposing details', async (response) => {
    await expect(
      shortenLink(
        'https://media.test/signed',
        'test-key',
        { expiresAt: new Date(timestamp + 14400000).toISOString() },
        vi.fn(async () => response),
      ),
    ).rejects.toMatchObject({ status: 503, code: 'SHORT_LINK_UNAVAILABLE' });
  });
});
