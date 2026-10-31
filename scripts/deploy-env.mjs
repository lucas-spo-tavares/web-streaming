import { readFileSync } from 'node:fs';
import { createPublicKey, createPrivateKey } from 'node:crypto';
import { resolve, isAbsolute } from 'node:path';
import {
  validateFields,
  isRegion,
  isHostname,
  isIntegerIn,
  MAX_UPLOAD_BYTES,
} from '../config/environment.mjs';

export function readRsaFile(path, kind, variable) {
  try {
    const pem = readFileSync(path, 'utf8');
    if (kind === 'public' && !/^-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(pem.trim()))
      throw new Error();
    const key = kind === 'public' ? createPublicKey(pem) : createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 2048)
      throw new Error();
    return { pem, key };
  } catch {
    throw new Error(
      `${variable}: informe um arquivo ${kind === 'public' ? 'público' : 'privado'} PEM RSA 2048 legível.`,
    );
  }
}
export function validateDeploy(env, { stage = 'infrastructure', cwd = process.cwd() } = {}) {
  if (!['infrastructure', 'owner', 'secrets'].includes(stage))
    return [{ name: 'STAGE', message: 'Use infrastructure, owner ou secrets.' }];
  const rules = { AWS_REGION: { check: isRegion, message: 'Informe a região da aplicação AWS.' } };
  if (stage === 'infrastructure') {
    Object.assign(rules, {
      TF_VAR_name: {
        check: (value) => /^[a-z][a-z0-9-]{2,29}$/.test(value),
        message: 'Use 3–30 caracteres minúsculos, números e hífens; comece com letra.',
      },
      TF_VAR_signing_public_key_path: {
        check: (value) => value.length > 0,
        message: 'Informe o caminho da chave pública PEM RSA 2048.',
      },
    });
  }
  if (stage === 'owner')
    rules.ACERVO_OWNER_EMAIL = {
      check: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      message: 'Informe o email administrativo do proprietário.',
    };
  if (stage === 'secrets')
    rules.ACERVO_SIGNING_PRIVATE_KEY_PATH = {
      check: (value) => value.length > 0,
      message: 'Informe o caminho da chave privada de primeiro setup.',
    };
  const issues = validateFields(env, rules);
  const tfRegion = env.TF_VAR_region ?? 'sa-east-1';
  if (stage === 'infrastructure') {
    if (!isRegion(tfRegion))
      issues.push({ name: 'TF_VAR_region', message: 'Informe uma região AWS válida.' });
    if (env.AWS_REGION && env.AWS_REGION !== tfRegion)
      issues.push({
        name: 'AWS_REGION/TF_VAR_region',
        message: 'AWS_REGION e TF_VAR_region devem coincidir.',
      });
    const zone = env.TF_VAR_hosted_zone_name ?? 'lucas-tavares.com';
    const domain = env.TF_VAR_frontend_domain_name ?? 'streaming.lucas-tavares.com';
    if (!isHostname(zone))
      issues.push({
        name: 'TF_VAR_hosted_zone_name',
        message: 'Informe o domínio da zona pública Route 53, sem protocolo ou ponto final.',
      });
    if (!isHostname(domain) || !domain.endsWith(`.${zone}`))
      issues.push({
        name: 'TF_VAR_frontend_domain_name',
        message: 'Informe um subdomínio da zona pública configurada, sem protocolo ou caminho.',
      });
    const appEnv = env.TF_VAR_environment ?? 'production';
    if (!['production', 'acceptance'].includes(appEnv))
      issues.push({ name: 'TF_VAR_environment', message: 'Use production ou acceptance.' });
    if (!/^http:\/\/localhost:\d+$/.test(env.TF_VAR_local_front_origin ?? 'http://localhost:5173'))
      issues.push({
        name: 'TF_VAR_local_front_origin',
        message: 'Use http://localhost:<porta>, conforme Terraform.',
      });
    if (!isIntegerIn(env.TF_VAR_max_upload_bytes ?? String(MAX_UPLOAD_BYTES), 1, MAX_UPLOAD_BYTES))
      issues.push({
        name: 'TF_VAR_max_upload_bytes',
        message: 'Use inteiro de 1 a 21474836480 bytes.',
      });
  }
  const variable =
    stage === 'infrastructure'
      ? 'TF_VAR_signing_public_key_path'
      : stage === 'secrets'
        ? 'ACERVO_SIGNING_PRIVATE_KEY_PATH'
        : null;
  if (variable && !issues.some((issue) => issue.name === variable)) {
    const value = env[variable];
    const path = isAbsolute(value)
      ? value
      : resolve(cwd, stage === 'infrastructure' ? 'infra' : '.', value);
    try {
      readRsaFile(path, stage === 'infrastructure' ? 'public' : 'private', variable);
    } catch (error) {
      issues.push({ name: variable, message: error.message.split(': ').slice(1).join(': ') });
    }
  }
  return issues;
}
