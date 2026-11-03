import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readRsaFile } from './deploy-env.mjs';
import { isParameterArn } from '../config/environment.mjs';

// Initialize only placeholders; preserve existing keys when this script is rerun.
export async function initializeSecrets({
  path = process.argv[2] || process.env.ACERVO_SIGNING_PRIVATE_KEY_PATH,
  output = (name) =>
    execFileSync('terraform', ['-chdir=infra', 'output', '-raw', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
  client,
} = {}) {
  function signingValue() {
    if (!path)
      throw new Error(
        'ACERVO_SIGNING_PRIVATE_KEY_PATH: informe a chave privada RSA para o primeiro setup.',
      );
    const { pem } = readRsaFile(path, 'private', 'ACERVO_SIGNING_PRIVATE_KEY_PATH');
    if (Buffer.byteLength(pem, 'utf8') > 4096)
      throw new Error('SIGNING_KEY: a chave excede o limite de 4 KB do nível Standard.');
    return pem;
  }
  const ticketArn = output('ticket_parameter_arn');
  const signingArn = output('signing_parameter_arn');
  if (!isParameterArn(ticketArn) || !isParameterArn(signingArn))
    throw new Error('PARAMETER_ARN: confira os outputs de referências do Terraform.');
  const sdk = client ?? new SSMClient({ region: signingArn.split(':')[3] });
  for (const [arn, createValue] of [
    [signingArn, signingValue],
    [ticketArn, () => randomBytes(48).toString('base64url')],
  ]) {
    const current = await sdk.send(new GetParameterCommand({ Name: arn, WithDecryption: true }));
    if (current.Parameter?.Type !== 'SecureString' || !current.Parameter.Value)
      throw new Error('PARAMETER_TYPE: esperado SecureString provisionado pelo Terraform.');
    if (current.Parameter.Value !== 'PENDING_SECRET_INITIALIZATION') continue;
    await sdk.send(
      new PutParameterCommand({
        Name: '/' + arn.split(':parameter/')[1],
        Value: createValue(),
        Type: 'SecureString',
        Tier: 'Standard',
        KeyId: 'alias/aws/ssm',
        Overwrite: true,
      }),
    );
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await initializeSecrets();
    console.log(
      'SecureStrings inicializados; valores existentes preservados e conteúdo não impresso.',
    );
  } catch {
    console.error(
      'SECRETS_SETUP: confira o caminho privado RSA 2048, outputs Terraform e permissões do perfil AWS. Nenhum valor de segredo foi impresso.',
    );
    process.exitCode = 1;
  }
}
