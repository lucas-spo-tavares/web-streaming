import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function deploy(target, run = execFileSync) {
  const execute = (command, args) => run(command, args, { stdio: 'inherit' });
  const output = (name) =>
    run('terraform', ['-chdir=infra', 'output', '-raw', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim();

  if (target === 'back') {
    execute('npm', ['run', 'env:check', '--', '--target', 'deploy']);
    execute('npm', ['run', 'build', '-w', 'back']);
    execute('npm', ['run', 'build:subtitles']);
    execute('terraform', ['-chdir=infra', 'init', '-input=false']);
    execute('terraform', ['-chdir=infra', 'fmt', '-check', '-recursive']);
    execute('terraform', ['-chdir=infra', 'validate']);
    execute('terraform', ['-chdir=infra', 'apply', '-input=false', '-auto-approve']);
    execute('node', ['--experimental-strip-types', 'scripts/init-secrets.mjs']);
    return;
  }
  if (target !== 'front') throw new Error('Uso: node scripts/deploy.mjs back|front');

  execute('node', ['--experimental-strip-types', 'scripts/write-front-env.mjs']);
  execute('npm', ['run', 'env:check', '--', '--target', 'front', '--file', 'front/.env.local']);
  execute('npm', ['run', 'build', '-w', 'front']);
  const bucket = output('frontend_bucket');
  const distribution = output('front_distribution_id');
  execute('aws', [
    's3',
    'sync',
    'front/dist/',
    `s3://${bucket}/`,
    '--exclude',
    'index.html',
    '--cache-control',
    'public,max-age=31536000,immutable',
  ]);
  execute('aws', [
    's3',
    'cp',
    'front/dist/index.html',
    `s3://${bucket}/index.html`,
    '--cache-control',
    'no-cache,no-store,must-revalidate',
    '--content-type',
    'text/html',
  ]);
  execute('aws', [
    'cloudfront',
    'create-invalidation',
    '--distribution-id',
    distribution,
    '--paths',
    '/index.html',
    '/',
    '/callback',
  ]);
  console.log(output('frontend_url'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    deploy(process.argv[2]);
  } catch (error) {
    // Child commands already report their error; do not dump their environment or buffers.
    console.error('Deploy interrompido. Confira a etapa que falhou antes de executar novamente.');
    process.exitCode = typeof error.status === 'number' && error.status > 0 ? error.status : 1;
  }
}
