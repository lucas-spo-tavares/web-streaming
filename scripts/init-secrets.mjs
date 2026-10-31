import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SecretsManagerClient, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readRsaFile } from './deploy-env.mjs';
import { isSecretArn } from '../config/environment.mjs';

// First provisioning only: do not regenerate ticket keys on every deploy.
export async function initializeSecrets({
  path = process.argv[2] || process.env.ACERVO_SIGNING_PRIVATE_KEY_PATH,
  output = (name) =>
    execFileSync('terraform', ['-chdir=infra', 'output', '-raw', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
  client,
} = {}) {
  if (!path)
    throw new Error(
      'ACERVO_SIGNING_PRIVATE_KEY_PATH: informe o caminho seguro da chave privada RSA ou um argumento posicional.',
    );
  const { pem } = readRsaFile(path, 'private', 'ACERVO_SIGNING_PRIVATE_KEY_PATH');
  const ticketArn = output('ticket_secret_arn');
  const signingArn = output('signing_secret_arn');
  if (!isSecretArn(ticketArn) || !isSecretArn(signingArn))
    throw new Error('SECRET_ARN: confira os outputs de referências do Terraform.');
  const sdk = client ?? new SecretsManagerClient({ region: signingArn.split(':')[3] });
  await sdk.send(new PutSecretValueCommand({ SecretId: signingArn, SecretString: pem }));
  await sdk.send(
    new PutSecretValueCommand({
      SecretId: ticketArn,
      SecretString: randomBytes(48).toString('base64url'),
    }),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await initializeSecrets();
    console.log('Segredos inseridos sem gravar valores no Terraform ou imprimir seu conteúdo.');
  } catch {
    console.error(
      'SECRETS_SETUP: confira o caminho privado RSA 2048, outputs Terraform e permissões do perfil AWS. Nenhum valor de segredo foi impresso.',
    );
    process.exitCode = 1;
  }
}
