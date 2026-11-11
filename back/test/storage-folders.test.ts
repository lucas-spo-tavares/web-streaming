import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import * as s3 from '@/repository/s3';
import * as retention from '@/repository/dynamo';

vi.mock('@/repository/dynamo');
const uuid = '12345678-1234-4123-8123-123456789abc';
const key = `${uuid}/video.mkv`;
beforeEach(() => {
  vi.stubEnv('MEDIA_BUCKET', 'media-test');
  vi.resetAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('video folder storage', () => {
  it('excludes derived files before looking up retention or listing videos', async () => {
    const now = new Date();
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Contents: [
        { Key: `${uuid}/tracks.json`, LastModified: now },
        { Key: `${uuid}/3-por.vtt`, LastModified: now },
        { Key: key, Size: 100, LastModified: now },
      ],
    } as never);
    vi.mocked(retention.batch).mockResolvedValue(new Map());
    expect((await s3.list()).objects).toEqual([{ key, size: 100, created: now }]);
    expect(retention.batch).toHaveBeenCalledWith([key]);
  });
  it('deletes only the matching UUID folder, with the video last', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Contents: [{ Key: key }, { Key: `${uuid}/tracks.json` }, { Key: `${uuid}/3-por.srt` }],
      })
      .mockResolvedValue({});
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send);
    await s3.deleteFile(key);
    expect(retention.claimDeletion).toHaveBeenCalledWith(key);
    expect(send.mock.calls[0][0].input).toMatchObject({ Prefix: uuid + '/' });
    expect(send.mock.calls[1][0].input.Delete.Objects).toEqual([
      { Key: `${uuid}/tracks.json` },
      { Key: `${uuid}/3-por.srt` },
    ]);
    expect(send.mock.calls[2][0].input).toEqual({ Bucket: 'media-test', Key: key });
  });
  it('keeps the video discoverable when deletion of a subtitle fails', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Contents: [{ Key: key }, { Key: `${uuid}/tracks.json` }] })
      .mockResolvedValueOnce({ Errors: [{ Key: `${uuid}/tracks.json`, Code: 'AccessDenied' }] });
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send);
    await expect(s3.deleteFile(key)).rejects.toThrow('incomplete');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('does not delete a folder when a concurrent renewal wins', async () => {
    vi.mocked(retention.claimDeletion).mockResolvedValue(false);
    const send = vi.spyOn(S3Client.prototype, 'send');
    expect(await s3.deleteExpired(key, Date.now())).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it('resolves a video by UUID while ignoring its manifest and captions', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Contents: [{ Key: `${uuid}/tracks.json` }, { Key: key }] })
      .mockResolvedValueOnce({ ContentLength: 100, LastModified: new Date() });
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send);
    vi.mocked(retention.get).mockResolvedValue({ deleting: false });
    expect((await s3.findVideo(uuid))?.key).toBe(key);
    expect(send.mock.calls[1][0].input.Key).toBe(key);
  });
});
