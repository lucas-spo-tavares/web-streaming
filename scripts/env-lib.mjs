import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
export function loadEnvFile(file, inherited = process.env) {
  let parsed;
  try {
    parsed = parseEnv(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('ENV_FILE: informe um arquivo dotenv existente e legível.');
  }
  // Deliberately no shell interpolation: $(), backticks and ${...} remain literal.
  return { ...parsed, ...inherited };
}
