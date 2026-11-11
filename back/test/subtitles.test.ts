import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '@/handler';
import { subtitles } from '@/service';
import { keySchema } from '@/contracts';
import * as s3 from '@/repository/s3';

vi.mock('@/repository/s3');
vi.mock('@/aws');
const uuid = '12345678-1234-4123-8123-123456789abc';
const key = `${uuid}/filme #1.mkv`;
const track = {
  number: 3,
  language: 'por',
  label: 'Português',
  codec: 'subrip',
  default: true,
  forced: false,
  supported: true,
  srt: '3-por.srt',
  vtt: '3-por.vtt',
};
const manifest = { key, sourceETag: 'etag', status: 'ready', tracks: [track] };
function event(selected?: string) {
  return {
    routeKey:
      selected === undefined
        ? 'GET /videos/{uuid}/subtitles'
        : 'GET /videos/{uuid}/subtitles/{track}',
    pathParameters: { uuid, ...(selected === undefined ? {} : { track: selected }) },
    requestContext: {
      requestId: 'subtitles',
      authorizer: {
        jwt: { claims: { sub: 'owner', token_use: 'access', 'cognito:groups': 'owners' } },
      },
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(s3.findVideo).mockResolvedValue({ key, created: new Date(), size: 100 });
  vi.mocked(s3.readText).mockImplementation(async (path) =>
    path.endsWith('tracks.json')
      ? JSON.stringify(manifest)
      : 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOlá',
  );
});
afterEach(() => vi.restoreAllMocks());

describe('UUID subtitle GET routes', () => {
  it('returns the track manifest by UUID without a body or the original filename', async () => {
    const result = await handleRequest(event() as never, 'subtitles', () => {});
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).tracks).toEqual([track]);
    expect(s3.findVideo).toHaveBeenCalledWith(uuid);
  });
  it('returns a selected track as text/vtt', async () => {
    const result = await handleRequest(event('3') as never, 'subtitle', () => {});
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('text/vtt; charset=utf-8');
    expect(result.body).toContain('WEBVTT');
    expect(s3.readText).toHaveBeenLastCalledWith(`${uuid}/3-por.vtt`);
  });
  it('rejects POST, invalid UUIDs, unknown tracks and traversal', async () => {
    expect(
      (
        await handleRequest(
          { ...event(), routeKey: 'POST /subtitles' } as never,
          undefined,
          () => {},
        )
      ).statusCode,
    ).toBe(404);
    await expect(subtitles({ uuid: '../folder' })).rejects.toThrow();
    await expect(subtitles({ uuid, track: 4 })).rejects.toMatchObject({ status: 404 });
    expect((await handleRequest(event('../3') as never, 'subtitle', () => {})).statusCode).toBe(
      400,
    );
  });
  it('rejects expired, deleting and missing videos before reading subtitles', async () => {
    vi.mocked(s3.findVideo).mockResolvedValue({
      key,
      size: 100,
      created: new Date(Date.now() - 31 * 86400000),
    });
    await expect(subtitles({ uuid })).rejects.toMatchObject({ status: 410 });
    vi.mocked(s3.findVideo).mockResolvedValue({
      key,
      size: 100,
      created: new Date(),
      deleting: true,
    });
    await expect(subtitles({ uuid })).rejects.toMatchObject({ status: 404 });
    vi.mocked(s3.findVideo).mockResolvedValue(null);
    await expect(subtitles({ uuid })).rejects.toMatchObject({ status: 404 });
    expect(s3.readText).not.toHaveBeenCalled();
  });
  it('requires the owner JWT for both GET routes', async () => {
    const request = event();
    request.requestContext.authorizer.jwt.claims.token_use = 'id';
    expect((await handleRequest(request as never, undefined, () => {})).statusCode).toBe(401);
    expect(s3.findVideo).not.toHaveBeenCalled();
  });
  it('reports processing, failure and videos without tracks', async () => {
    vi.mocked(s3.readText).mockResolvedValue(null);
    expect(await subtitles({ uuid })).toMatchObject({ status: 'processing', tracks: [] });
    vi.mocked(s3.findVideo).mockResolvedValue({
      key,
      size: 100,
      created: new Date(Date.now() - 25 * 60000),
    });
    expect(await subtitles({ uuid })).toMatchObject({ status: 'failed' });
    vi.mocked(s3.readText).mockResolvedValue(JSON.stringify({ ...manifest, tracks: [] }));
    expect(await subtitles({ uuid })).toMatchObject({ status: 'ready', tracks: [] });
  });
});

describe('video folder keys', () => {
  it('accepts videos in UUID folders and excludes generated files and legacy keys', () => {
    expect(keySchema.safeParse(key).success).toBe(true);
    for (const invalid of [
      `${uuid}--filme.mkv`,
      `${uuid}/tracks.json`,
      `${uuid}/3-por.vtt`,
      `${uuid}/3-por.srt`,
      `${uuid}/../filme.mkv`,
    ])
      expect(keySchema.safeParse(invalid).success).toBe(false);
  });
});
