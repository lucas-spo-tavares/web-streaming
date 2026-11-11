import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateFront, validateBackend } from '../config/environment.ts';
import { validateDeploy } from './deploy-env.mjs';
import { loadEnvFile } from './env-lib.mjs';
export function checkEnvironment(args, inherited = process.env) {
  let options;
  try {
    options = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        target: { type: 'string' },
        file: { type: 'string' },
        operation: { type: 'string' },
        stage: { type: 'string' },
      },
    }).values;
  } catch {
    throw new Error(
      'ARGS: use --target front|backend|deploy [--file caminho] [--operation operação] [--stage infrastructure|owner|secrets].',
    );
  }
  if (!['front', 'backend', 'deploy'].includes(options.target))
    throw new Error('TARGET: use front, backend ou deploy.');
  if (options.operation && options.target !== 'backend')
    throw new Error('OPERATION: use --operation apenas com --target backend.');
  if (options.stage && options.target !== 'deploy')
    throw new Error('STAGE: use --stage apenas com --target deploy.');
  const env = options.file ? loadEnvFile(options.file, inherited) : inherited;
  const issues =
    options.target === 'front'
      ? validateFront(env)
      : options.target === 'backend'
        ? validateBackend(env, options.operation ?? env.OPERATION)
        : validateDeploy(env, { stage: options.stage });
  return { target: options.target, issues };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { target, issues } = checkEnvironment(process.argv.slice(2));
    if (issues.length) {
      console.error(issues.map((issue) => `${issue.name}: ${issue.message}`).join('\n'));
      process.exitCode = 1;
    } else
      console.log(
        `Configuração ${target} válida (verificação local; nenhum serviço AWS consultado).`,
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
