import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadEnvFile } from './env-lib.mjs';
export function runWithEnv(file, executable, args = [], inherited = process.env) {
  if (!file || !executable)
    throw new Error('USAGE: node scripts/with-env.mjs <arquivo> <executável> [args...]');
  const env = loadEnvFile(file, inherited);
  return new Promise((resolveExit, reject) => {
    const child = spawn(executable, args, { env, stdio: 'inherit', shell: false });
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const handlers = signals.map((signal) => {
      const handler = () => child.kill(signal);
      process.on(signal, handler);
      return [signal, handler];
    });
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    child.on('error', () => {
      cleanup();
      reject(new Error('COMMAND: não foi possível iniciar o executável solicitado.'));
    });
    child.on('exit', (code, signal) => {
      cleanup();
      resolveExit({ code: code ?? 1, signal });
    });
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runWithEnv(process.argv[2], process.argv[3], process.argv.slice(4));
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.code;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
