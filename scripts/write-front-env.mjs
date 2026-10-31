import { execFileSync } from 'node:child_process';
import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FRONT_KEYS, validateFront, assertValid } from '../config/environment.mjs';
export function writeFrontEnv(outputs, destination = 'front/.env.local') {
  assertValid(validateFront(outputs));
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.tmp`);
  try {
    // JSON quoting protects spaces/#/newlines; dotenv parser receives only public allowlisted values.
    writeFileSync(
      temporary,
      FRONT_KEYS.map((key) => `${key}=${JSON.stringify(outputs[key])}`).join('\n') + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outputs = JSON.parse(
      execFileSync('terraform', ['-chdir=infra', 'output', '-json', 'frontend_config'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    writeFrontEnv(outputs);
    console.log('Configuração pública gravada em front/.env.local.');
  } catch {
    console.error(
      'FRONT_CONFIG: confira os outputs públicos do Terraform e valide API URL, client ID e região Cognito. O arquivo anterior foi preservado.',
    );
    process.exitCode = 1;
  }
}
