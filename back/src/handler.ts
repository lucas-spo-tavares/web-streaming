import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ZodError } from 'zod';
import { config } from '@/config';
import { ApiError } from '@/core';
import {
  list,
  start,
  parts,
  complete,
  abort,
  deleteFile,
  renew,
  download,
  stream,
  short,
  expireFiles,
} from '@/service';
import { validateConfiguration } from '@/aws';

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
const service = {
  list,
  start,
  parts,
  complete,
  abort,
  delete: deleteFile,
  renew,
  download,
  stream,
  short,
};
const routes: Record<string, keyof typeof service> = {
  'GET /files': 'list',
  'DELETE /files': 'delete',
  'POST /files/renew': 'renew',
  'POST /download-links': 'download',
  'POST /uploads': 'start',
  'POST /uploads/parts': 'parts',
  'POST /uploads/complete': 'complete',
  'POST /uploads/abort': 'abort',
  'POST /stream-links': 'stream',
  'POST /short-links': 'short',
};
export function authorize(event: Event) {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims?.sub || claims.token_use !== 'access')
    throw new ApiError(401, 'UNAUTHENTICATED', 'Entre para continuar.');
  const groups = String(claims['cognito:groups'] ?? '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replaceAll('"', '')
    .replaceAll("'", '')
    .split(/[,\s]+/);
  if (!groups.includes('owners'))
    throw new ApiError(403, 'FORBIDDEN', 'Acesso exclusivo do proprietário.');
  return String(claims.sub);
}
export async function handleRequest(
  event: Event,
  operation?: string,
  logger = (entry: object) => console.info(JSON.stringify(entry)),
) {
  const requestId = event.requestContext.requestId;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-request-id': requestId,
  };
  try {
    const sub = authorize(event);
    const action = routes[event.routeKey];
    if (!action || (operation && action !== operation))
      throw new ApiError(404, 'NOT_FOUND', 'Operação não encontrada.');
    let input: unknown;
    if (action === 'list') input = event.queryStringParameters ?? {};
    else {
      const body = event.isBase64Encoded
        ? Buffer.from(event.body ?? '', 'base64').toString()
        : (event.body ?? '');
      if (Buffer.byteLength(body) > 512000)
        throw new ApiError(413, 'BODY_TOO_LARGE', 'Requisição excede o limite.');
      try {
        input = JSON.parse(body);
      } catch {
        throw new ApiError(400, 'INVALID_JSON', 'JSON inválido.');
      }
    }
    validateConfiguration();
    const result = await service[action](input, sub);
    logger({ requestId, operation: action, status: 200 });
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (error) {
    const normalized =
      error instanceof ZodError
        ? new ApiError(400, 'INVALID_INPUT', 'Dados inválidos.')
        : error instanceof ApiError
          ? error
          : new ApiError(503, 'SERVICE_UNAVAILABLE', 'Serviço indisponível. Tente novamente.');
    logger({
      requestId,
      operation: routes[event.routeKey] ?? 'unknown',
      status: normalized.status,
      code: normalized.code,
    });
    return {
      statusCode: normalized.status,
      headers,
      body: JSON.stringify({ code: normalized.code, message: normalized.message, requestId }),
    };
  }
}

export async function handler(event: Event) {
  return handleRequest(event, config.OPERATION);
}

export async function cleanup() {
  validateConfiguration();
  const result = await expireFiles();
  console.info(JSON.stringify({ operation: 'cleanup', ...result }));
  return result;
}
