import { describe, it, expect, vi } from 'vitest';
import { createService, expireFiles, type Dependencies, type StoredObject } from '../src/service';
import { RetentionStore } from '../src/retention';
import { RETENTION_MS } from '../src/contracts';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const key = '12345678-1234-4123-8123-123456789abc--vídeo 100% #1.mp4';
const now = Date.parse('2026-11-03T15:00:00Z');
function setup(
  object: StoredObject | null = {
    key,
    size: 20 * 1024 ** 3,
    created: new Date(now - 29 * 86400000),
  },
) {
  const d: Dependencies = {
    now: () => now,
    mediaDomain: 'media.acervo.test',
    ticketSecret: vi.fn(async () => 'secret'),
    signStream: vi.fn(async () => 'https://media.acervo.test/signed'),
    signDownload: vi.fn(async () => 'https://bucket.s3.test/download'),
    storage: {
      list: vi.fn(async () => ({ objects: object ? [object] : [] })),
      head: vi.fn(async () => object),
      renew: vi.fn(async () => true),
      deleteExpired: vi.fn(async () => true),
      delete: vi.fn(),
      start: vi.fn(),
      signPart: vi.fn(),
      listParts: vi.fn(),
      complete: vi.fn(),
      abort: vi.fn(),
    },
  };
  return { d, service: createService(d) };
}
describe('renewal and download', () => {
  it('renews a 20 GiB video to thirty days from now without copying bytes or changing its upload date', async () => {
    const { d, service } = setup();
    const result = await service.renew({ key });
    expect(d.storage.renew).toHaveBeenCalledWith(key, new Date(now + RETENTION_MS));
    expect(result.file.expiresAt).toBe(new Date(now + RETENTION_MS).toISOString());
    expect(result.file.createdAt).toBe(new Date(now - 29 * 86400000).toISOString());
    expect(result.file.expired).toBe(false);
    expect(d.storage.start).not.toHaveBeenCalled();
  });
  it('renews expired objects that still exist and refuses objects already claimed for deletion', async () => {
    const { d, service } = setup({ key, size: 1, created: new Date(now - 31 * 86400000) });
    expect((await service.renew({ key })).file.expired).toBe(false);
    vi.mocked(d.storage.renew).mockResolvedValue(false);
    await expect(service.renew({ key })).rejects.toMatchObject({
      status: 409,
      code: 'DELETION_STARTED',
    });
    const missing = setup(null);
    await expect(missing.service.renew({ key })).rejects.toMatchObject({ status: 404 });
    expect(missing.d.storage.renew).not.toHaveBeenCalled();
  });
  it('uses the same renewed deadline for listing and streaming', async () => {
    const expires = new Date(now + 86400000);
    const { d, service } = setup({ key, size: 1, created: new Date(now - 31 * 86400000), expires });
    const page = await service.list({}, 'owner');
    expect(page.files[0]).toMatchObject({ expired: false, expiresAt: expires.toISOString() });
    await service.stream({ key });
    expect(d.signStream).toHaveBeenCalledWith(
      expect.stringContaining('v%C3%ADdeo%20100%25%20%231.mp4'),
      now + 4 * 3600000,
    );
  });
  it('creates a download link with original filename, lasting at most fifteen minutes', async () => {
    const { d, service } = setup();
    const result = await service.download({ key });
    expect(d.signDownload).toHaveBeenCalledWith(key, 'vídeo 100% #1.mp4', now + 15 * 60000);
    expect(result.expiresAt).toBe(new Date(now + 15 * 60000).toISOString());
    const remaining = setup({
      key,
      size: 1,
      created: new Date(now),
      expires: new Date(now + 60000),
    });
    expect((await remaining.service.download({ key })).expiresAt).toBe(
      new Date(now + 60000).toISOString(),
    );
  });
  it('does not issue links for missing, deleting or expired videos', async () => {
    for (const object of [
      null,
      { key, size: 1, created: new Date(now - 31 * 86400000) },
      { key, size: 1, created: new Date(now), deleting: true },
    ]) {
      const { d, service } = setup(object);
      await expect(service.download({ key })).rejects.toMatchObject({
        status: object && !object.deleting ? 410 : 404,
      });
      expect(d.signDownload).not.toHaveBeenCalled();
    }
  });
  it('rejects invalid keys before reading storage', async () => {
    const { d, service } = setup();
    await expect(service.renew({ key: '../video.mp4' })).rejects.toThrow();
    await expect(service.download({ key, bucket: 'other' })).rejects.toThrow();
    expect(d.storage.head).not.toHaveBeenCalled();
  });
});

describe('scheduled cleanup', () => {
  it('follows pagination, preserves renewed videos and cleans expired videos only', async () => {
    const { d } = setup();
    const expired = { key, size: 1, created: new Date(now - 31 * 86400000) };
    const renewed = { ...expired, expires: new Date(now + RETENTION_MS) };
    vi.mocked(d.storage.list)
      .mockResolvedValueOnce({ objects: [renewed], token: 'next' })
      .mockResolvedValueOnce({ objects: [expired] });
    expect(await expireFiles(d)).toEqual({ deleted: 1 });
    expect(d.storage.list).toHaveBeenLastCalledWith('next');
    expect(d.storage.deleteExpired).toHaveBeenCalledExactlyOnceWith(key, now);
  });
  it('does not delete when a concurrent renewal wins the conditional write', async () => {
    const { d } = setup({ key, size: 1, created: new Date(now - 31 * 86400000) });
    vi.mocked(d.storage.deleteExpired).mockResolvedValue(false);
    expect(await expireFiles(d)).toEqual({ deleted: 0 });
  });
});

describe('atomic retention writes', () => {
  it('guards deletion against a newer renewal and renewal against started deletion', async () => {
    const error = Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException',
    });
    const send = vi.fn().mockRejectedValue(error);
    const store = new RetentionStore('retention', { send } as unknown as DynamoDBClient);
    expect(await store.claimDeletion(key, now)).toBe(false);
    expect(send.mock.calls[0][0].input).toMatchObject({
      ConditionExpression:
        'attribute_not_exists(expiresAt) OR expiresAt <= :now OR #deleting = :yes',
      ExpressionAttributeValues: { ':now': { N: String(now) } },
    });
    expect(await store.renew(key, new Date(now + RETENTION_MS))).toBe(false);
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
    const store = new RetentionStore('retention', { send } as unknown as DynamoDBClient);
    const result = await store.batch([key]);
    expect(result.get(key)?.expires?.getTime()).toBe(now + RETENTION_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.RequestItems.retention.ConsistentRead).toBe(true);
  });
});
