import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHandler } from '../src/handler.ts';
import { validateBackend } from '../../config/environment.mjs';

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
  const handler = createHandler(
    () => ({
      storage: {
        delete: async (key) => {
          await remove();
          deleted.push(key);
        },
      },
    }),
    'delete',
    () => {},
  );
  return { handler, deleted };
}

test('deletion accepts a valid key and remains idempotent', async () => {
  const { handler, deleted } = fixture();
  for (let i = 0; i < 2; i++) {
    const response = await handler(event());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { deleted: true });
  }
  assert.deepEqual(deleted, [key, key]);
});

test('invalid keys and unexpected fields never reach storage', async () => {
  const { handler, deleted } = fixture();
  for (const body of [{ key: '../video.mp4' }, {}, { key, bucket: 'other-bucket' }]) {
    assert.equal((await handler(event(body))).statusCode, 400);
  }
  assert.deepEqual(deleted, []);
});

test('unauthenticated users and users outside owners cannot delete', async () => {
  const { handler, deleted } = fixture();
  assert.equal((await handler(event({ key }, {}))).statusCode, 401);
  assert.equal(
    (await handler(event({ key }, { sub: 'user', token_use: 'access' }))).statusCode,
    403,
  );
  assert.deepEqual(deleted, []);
});

test('delete Lambda rejects other operations and reports storage failures', async () => {
  const { handler, deleted } = fixture(async () => {
    throw new Error('internal AWS details');
  });
  assert.equal((await handler({ ...event(), routeKey: 'POST /stream-links' })).statusCode, 404);
  const response = await handler(event());
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
  const handler = createHandler(
    () => ({
      storage: {
        start: async () => {
          starts++;
          return 'upload-id';
        },
      },
      ticketSecret: async () => 'a'.repeat(64),
    }),
    'start',
    () => {},
  );
  for (const body of [
    { name: 'document.pdf', size: 100, contentType: 'application/pdf' },
    { name: 'image.png', size: 100, contentType: 'video/mp4' },
    { name: 'video.mp4', size: 100, contentType: 'text/plain' },
    { name: 'music.mp3', size: 100, contentType: 'audio/mpeg' },
  ]) {
    assert.equal((await handler({ ...event(body), routeKey: 'POST /uploads' })).statusCode, 400);
  }
  assert.equal(starts, 0);
});

test('upload accepts videos and infers MIME for browsers reporting a generic or missing type', async () => {
  const types = [];
  const handler = createHandler(
    () => ({
      storage: {
        start: async (key, type) => {
          types.push(type);
          return 'upload-id';
        },
      },
      ticketSecret: async () => 'a'.repeat(64),
    }),
    'start',
    () => {},
  );
  for (const body of [
    { name: 'vídeo.MP4', size: 100, contentType: 'video/mp4' },
    { name: 'video.webm', size: 100 },
    { name: 'video.mkv', size: 100, contentType: 'application/octet-stream' },
  ]) {
    const response = await handler({ ...event(body), routeKey: 'POST /uploads' });
    assert.equal(response.statusCode, 200);
    assert.ok(JSON.parse(response.body).ticket);
  }
  assert.deepEqual(types, ['video/mp4', 'video/webm', 'video/x-matroska']);
});
