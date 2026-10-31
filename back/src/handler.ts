import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ZodError } from 'zod';
import { ApiError } from './core.js';
import { createService, type Dependencies } from './service.js';
import { awsDependencies } from './aws.js';

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
const routes: Record<string, string> = {
  'GET /files': 'list',
  'POST /uploads': 'start',
  'POST /uploads/parts': 'parts',
  'POST /uploads/complete': 'complete',
  'POST /uploads/abort': 'abort',
  'POST /stream-links': 'stream',
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
export function createHandler(
  dependencies: () => Dependencies,
  operation?: string,
  logger = (entry: object) => console.info(JSON.stringify(entry)),
) {
  return async (event: Event) => {
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
      const service = createService(dependencies());
      const result = await service[action as keyof typeof service](input, sub);
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
  };
}
export const handler = createHandler(awsDependencies, process.env.OPERATION);
