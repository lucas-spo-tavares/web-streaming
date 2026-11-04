import { ApiError } from './core.js';

const origin = 'https://link.lucas-tavares.com';

export async function shortenLink(url: string, apiKey: string, request = fetch): Promise<string> {
  try {
    const response = await request(`${origin}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
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
  } catch {
    throw new ApiError(
      503,
      'SHORT_LINK_UNAVAILABLE',
      'Não foi possível gerar o link curto. Tente novamente.',
    );
  }
}
