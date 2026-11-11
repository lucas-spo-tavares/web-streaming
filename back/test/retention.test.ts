import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mediaDomain, ticketSecret, signStream } from '@/aws';
import { renew, list, stream, download, expireFiles, type StoredObject } from '@/service';
import * as retention from '@/repository/dynamo';
import * as s3Repository from '@/repository/s3';
import { RETENTION_MS } from '@/contracts';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

vi.mock('@/aws');
vi.mock('@/repository/s3');

afterEach(() => {
  vi.restoreAllMocks();
});

const key = '12345678-1234-4123-8123-123456789abc/vídeo 100% #1.mp4';
const now = Date.parse('2026-11-03T15:00:00Z');
function setup(
  object: StoredObject | null = {
    key,
    size: 20 * 1024 ** 3,
    created: new Date(now - 29 * 86400000),
  },
) {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.mocked(mediaDomain).mockReturnValue('media.acervo.test');
  vi.mocked(ticketSecret).mockResolvedValue('secret');
  vi.mocked(signStream).mockResolvedValue('https://media.acervo.test/signed');
  vi.mocked(s3Repository.list).mockResolvedValue({
    objects: object ? [object] : [],
    token: undefined,
  });
  vi.mocked(s3Repository.head).mockResolvedValue(object);
  vi.mocked(s3Repository.deleteExpired).mockResolvedValue(true);
  vi.mocked(s3Repository.signDownload).mockResolvedValue('https://bucket.s3.test/download');
  vi.spyOn(retention, 'renew').mockResolvedValue(true);
}
describe('renewal and download', () => {
  it('renews a 20 GiB video to thirty days from now without copying bytes or changing its upload date', async () => {
    setup();
    const result = await renew({ key });
    expect(retention.renew).toHaveBeenCalledWith(key, new Date(now + RETENTION_MS));
    expect(result.file.expiresAt).toBe(new Date(now + RETENTION_MS).toISOString());
    expect(result.file.createdAt).toBe(new Date(now - 29 * 86400000).toISOString());
    expect(result.file.expired).toBe(false);
    expect(s3Repository.start).not.toHaveBeenCalled();
  });
  it('renews expired objects that still exist and refuses objects already claimed for deletion', async () => {
    setup({ key, size: 1, created: new Date(now - 31 * 86400000) });
    expect((await renew({ key })).file.expired).toBe(false);
    vi.mocked(retention.renew).mockResolvedValue(false);
    await expect(renew({ key })).rejects.toMatchObject({
      status: 409,
      code: 'DELETION_STARTED',
    });
    setup(null);
    await expect(renew({ key })).rejects.toMatchObject({ status: 404 });
    expect(retention.renew).not.toHaveBeenCalled();
  });
  it('uses the same renewed deadline for listing and streaming', async () => {
    const expires = new Date(now + 86400000);
    setup({ key, size: 1, created: new Date(now - 31 * 86400000), expires });
    const page = await list({}, 'owner');
    expect(page.files[0]).toMatchObject({ expired: false, expiresAt: expires.toISOString() });
    await stream({ key });
    expect(signStream).toHaveBeenCalledWith(
      expect.stringContaining('v%C3%ADdeo%20100%25%20%231.mp4'),
      now + 4 * 3600000,
    );
  });
  it('creates a download link with original filename, lasting at most fifteen minutes', async () => {
    setup();
    const result = await download({ key });
    expect(s3Repository.signDownload).toHaveBeenCalledWith(
      key,
      'vídeo 100% #1.mp4',
      now + 15 * 60000,
    );
    expect(result.expiresAt).toBe(new Date(now + 15 * 60000).toISOString());
    setup({
      key,
      size: 1,
      created: new Date(now),
      expires: new Date(now + 60000),
    });
    expect((await download({ key })).expiresAt).toBe(new Date(now + 60000).toISOString());
  });
  it('does not issue links for missing, deleting or expired videos', async () => {
    for (const object of [
      null,
      { key, size: 1, created: new Date(now - 31 * 86400000) },
      { key, size: 1, created: new Date(now), deleting: true },
    ]) {
      setup(object);
      await expect(download({ key })).rejects.toMatchObject({
        status: object && !object.deleting ? 410 : 404,
      });
      expect(s3Repository.signDownload).not.toHaveBeenCalled();
    }
  });
  it('rejects invalid keys before reading storage', async () => {
    setup();
    await expect(renew({ key: '../video.mp4' })).rejects.toThrow();
    await expect(download({ key, bucket: 'other' })).rejects.toThrow();
    expect(s3Repository.head).not.toHaveBeenCalled();
  });
});

describe('scheduled cleanup', () => {
  it('follows pagination, preserves renewed videos and cleans expired videos only', async () => {
    setup();
    const expired = { key, size: 1, created: new Date(now - 31 * 86400000) };
    const renewed = { ...expired, expires: new Date(now + RETENTION_MS) };
    vi.mocked(s3Repository.list)
      .mockResolvedValueOnce({ objects: [renewed], token: 'next' })
      .mockResolvedValueOnce({ objects: [expired], token: undefined });
    expect(await expireFiles()).toEqual({ deleted: 1 });
    expect(s3Repository.list).toHaveBeenLastCalledWith('next');
    expect(s3Repository.deleteExpired).toHaveBeenCalledExactlyOnceWith(key, now);
  });
  it('does not delete when a concurrent renewal wins the conditional write', async () => {
    setup({ key, size: 1, created: new Date(now - 31 * 86400000) });
    vi.mocked(s3Repository.deleteExpired).mockResolvedValue(false);
    expect(await expireFiles()).toEqual({ deleted: 0 });
  });
});

describe('atomic retention writes', () => {
  beforeEach(() => {
    vi.stubEnv('RETENTION_TABLE', 'retention');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('guards deletion against a newer renewal and renewal against started deletion', async () => {
    const error = Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException',
    });
    const send = vi.fn().mockRejectedValue(error);
    vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(send);
    expect(await retention.claimDeletion(key, now)).toBe(false);
    expect(send.mock.calls[0][0].input).toMatchObject({
      ConditionExpression:
        'attribute_not_exists(expiresAt) OR expiresAt <= :now OR #deleting = :yes',
      ExpressionAttributeValues: { ':now': { N: String(now) } },
    });
    expect(await retention.renew(key, new Date(now + RETENTION_MS))).toBe(false);
    expect(send.mock.calls[1][0].input.ConditionExpression).toBe('attribute_not_exists(#deleting)');
  });
  it('retries unprocessed keys instead of treating a throttled renewal record as absent', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ UnprocessedKeys: { retention: { Keys: [{ key: { S: key } }] } } })
      .mockResolvedValueOnce({
        Responses: {
          retention: [{ key: { S: key }, expiresAt: { N: String(now + RETENTION_MS) } }],
        },
      });
    vi.spyOn(DynamoDBClient.prototype, 'send').mockImplementation(send);
    const result = await retention.batch([key]);
    expect(result.get(key)?.expires?.getTime()).toBe(now + RETENTION_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.RequestItems.retention.ConsistentRead).toBe(true);
  });
});
