import { ApiError } from './core.js';

const origin = 'https://link.lucas-tavares.com';

export async function shortenLink(
  url: string,
  apiKey: string,
  options: { expiresAt: string; code?: string },
  request = fetch,
): Promise<string> {
  try {
    const response = await request(`${origin}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ url, ...options, maxAccesses: 5 }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (response.status === 403 && options.code)
      throw new ApiError(
        409,
        'SHORT_LINK_CODE_UNAVAILABLE',
        'Este código já pertence a outra chave. Escolha outro.',
      );
    if (!response.ok) throw new Error();
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('shortUrl' in data) ||
      typeof data.shortUrl !== 'string'
    )
      throw new Error();
    const short = new URL(data.shortUrl);
    if (short.origin !== origin || short.username || short.password || short.pathname === '/')
      throw new Error();
    return short.href;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      'SHORT_LINK_UNAVAILABLE',
      'Não foi possível gerar o link curto. Tente novamente.',
    );
  }
}
