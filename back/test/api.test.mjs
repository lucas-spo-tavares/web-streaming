import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import * as s3Repository from '../src/repository/s3.ts';
import { maxBytes, ticketSecret } from '../src/aws.ts';
import { MAX_BYTES } from '../src/contracts.ts';
import { handleRequest } from '../src/handler.ts';
import { validateBackend } from '../../config/environment.mjs';

vi.mock('../src/aws');
vi.mock('../src/repository/s3');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(maxBytes).mockReturnValue(MAX_BYTES);
  vi.mocked(ticketSecret).mockResolvedValue('a'.repeat(64));
});

const key = '12345678-1234-4123-8123-123456789abc--video.mp4';
const event = (
  body = { key },
  claims = { sub: 'owner', token_use: 'access', 'cognito:groups': 'owners' },
) => ({
  routeKey: 'DELETE /files',
  body: JSON.stringify(body),
  requestContext: { requestId: 'delete-test', authorizer: { jwt: { claims } } },
});
function fixture(remove = async () => {}) {
  const deleted = [];
  vi.mocked(s3Repository.deleteFile).mockImplementation(async (key) => {
    await remove();
    deleted.push(key);
  });
  return { deleted };
}

test('deletion accepts a valid key and remains idempotent', async () => {
  const { deleted } = fixture();
  for (let i = 0; i < 2; i++) {
    const response = await handleRequest(event(), 'delete', () => {});
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { deleted: true });
  }
  assert.deepEqual(deleted, [key, key]);
});

test('invalid keys and unexpected fields never reach storage', async () => {
  const { deleted } = fixture();
  for (const body of [{ key: '../video.mp4' }, {}, { key, bucket: 'other-bucket' }]) {
    assert.equal((await handleRequest(event(body), 'delete', () => {})).statusCode, 400);
  }
  assert.deepEqual(deleted, []);
});

test('unauthenticated users and users outside owners cannot delete', async () => {
  const { deleted } = fixture();
  assert.equal((await handleRequest(event({ key }, {}), 'delete', () => {})).statusCode, 401);
  assert.equal(
    (await handleRequest(event({ key }, { sub: 'user', token_use: 'access' }), 'delete', () => {}))
      .statusCode,
    403,
  );
  assert.deepEqual(deleted, []);
});

test('delete Lambda rejects other operations and reports storage failures', async () => {
  const { deleted } = fixture(async () => {
    throw new Error('internal AWS details');
  });
  assert.equal(
    (await handleRequest({ ...event(), routeKey: 'POST /stream-links' }, 'delete', () => {}))
      .statusCode,
    404,
  );
  const response = await handleRequest(event(), 'delete', () => {});
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).code, 'SERVICE_UNAVAILABLE');
  assert.ok(!response.body.includes('internal AWS details'));
  assert.deepEqual(deleted, []);
});

test('delete runtime requires no ticket or signing secret', () => {
  assert.deepEqual(
    validateBackend({
      OPERATION: 'delete',
      MEDIA_BUCKET: 'app-media',
      AWS_REGION: 'sa-east-1',
      RETENTION_TABLE: 'app-retention',
    }),
    [],
  );
});

test('upload rejects non-video files before creating a multipart session', async () => {
  let starts = 0;
  vi.mocked(s3Repository.start).mockImplementation(async () => {
    starts++;
    return 'upload-id';
  });
  for (const body of [
    { name: 'document.pdf', size: 100, contentType: 'application/pdf' },
    { name: 'image.png', size: 100, contentType: 'video/mp4' },
    { name: 'video.mp4', size: 100, contentType: 'text/plain' },
    { name: 'music.mp3', size: 100, contentType: 'audio/mpeg' },
  ]) {
    assert.equal(
      (await handleRequest({ ...event(body), routeKey: 'POST /uploads' }, 'start', () => {}))
        .statusCode,
      400,
    );
  }
  assert.equal(starts, 0);
});

test('upload accepts videos and infers MIME for browsers reporting a generic or missing type', async () => {
  const types = [];
  vi.mocked(s3Repository.start).mockImplementation(async (key, type) => {
    types.push(type);
    return 'upload-id';
  });
  for (const body of [
    { name: 'vídeo.MP4', size: 100, contentType: 'video/mp4' },
    { name: 'video.webm', size: 100 },
    { name: 'video.mkv', size: 100, contentType: 'application/octet-stream' },
  ]) {
    const response = await handleRequest(
      { ...event(body), routeKey: 'POST /uploads' },
      'start',
      () => {},
    );
    assert.equal(response.statusCode, 200);
    assert.ok(JSON.parse(response.body).ticket);
  }
  assert.deepEqual(types, ['video/mp4', 'video/webm', 'video/x-matroska']);
});
