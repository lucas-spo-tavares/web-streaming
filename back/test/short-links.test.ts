import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shortenLink } from '../src/short-links';
import { handleRequest } from '../src/handler';
import { shorten as shortenUrl, signStream, mediaDomain } from '../src/aws';
import * as s3Repository from '../src/repository/s3';

vi.mock('../src/aws');
vi.mock('../src/repository/s3');

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(timestamp);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const key = '12345678-1234-4123-8123-123456789abc--video.mp4';
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
    expect(shorten).toHaveBeenCalledExactlyOnceWith('https://media.test/signed');
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
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ shortUrl: 'https://link.lucas-tavares.com/abcdef' }), {
          status: 201,
        }),
    );
    expect(await shortenLink('https://media.test/signed', 'test-key', request)).toBe(
      'https://link.lucas-tavares.com/abcdef',
    );
    expect(request).toHaveBeenCalledWith(
      'https://link.lucas-tavares.com/links',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
        body: JSON.stringify({ url: 'https://media.test/signed' }),
      }),
    );
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
        vi.fn(async () => response),
      ),
    ).rejects.toMatchObject({ status: 503, code: 'SHORT_LINK_UNAVAILABLE' });
  });
});
