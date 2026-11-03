// Pure validation shared by CLI, Vite and Lambda. No filesystem, process or network access.
export const FRONT_KEYS = ['VITE_API_URL', 'VITE_CLIENT_ID', 'VITE_AWS_REGION'];
export const OPERATIONS = [
  'list',
  'start',
  'parts',
  'complete',
  'abort',
  'stream',
  'delete',
  'renew',
  'download',
  'cleanup',
];
export const MAX_UPLOAD_BYTES = 21474836480;
export const REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;
const placeholder = /PREENCHA|REPLACE_ME|YOUR_|EXAMPLE|[<>]/i;
const present = (value) => typeof value === 'string' && value.trim().length > 0;
export function validateFields(env, rules) {
  const issues = [];
  for (const [name, rule] of Object.entries(rules)) {
    const value = env[name];
    if (!present(value) || placeholder.test(value) || !rule.check(value))
      issues.push({ name, message: rule.message });
  }
  return issues;
}
export function isRegion(value) {
  return REGION_PATTERN.test(value);
}
export function isBucket(value) {
  return (
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value) &&
    !value.includes('..') &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(value)
  );
}
export function isHostname(value) {
  return (
    value.length <= 253 &&
    value.includes('.') &&
    value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  );
}
export function isParameterArn(value) {
  return /^arn:aws(?:-us-gov|-cn)?:ssm:[a-z0-9-]+:\d{12}:parameter\/[a-zA-Z0-9/_.-]+$/.test(value);
}
export function isIntegerIn(value, min, max) {
  return (
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= max
  );
}
function isOrigin(value, local = false) {
  try {
    const url = new URL(value);
    return (
      !/\s/.test(value) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      (url.protocol === 'https:' ||
        (local &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
export function validateFront(env) {
  return validateFields(env, {
    VITE_API_URL: {
      check: (value) => isOrigin(value, true),
      message: 'Informe a origem HTTPS da API (HTTP apenas em loopback local).',
    },
    VITE_CLIENT_ID: {
      check: (value) => /^[a-zA-Z0-9_-]{1,128}$/.test(value),
      message: 'Informe o client ID público do Cognito.',
    },
    VITE_AWS_REGION: {
      check: isRegion,
      message: 'Informe a região AWS do Cognito, como sa-east-1.',
    },
  });
}
export function validateBackend(env, operation = env.OPERATION) {
  const rules = {
    OPERATION: {
      check: (value) => OPERATIONS.includes(value),
      message:
        'Escolha list, start, parts, complete, abort, stream, delete, renew, download ou cleanup.',
    },
    RETENTION_TABLE: {
      check: (value) => /^[a-zA-Z0-9_.-]{3,255}$/.test(value),
      message: 'Informe a tabela DynamoDB de retenção.',
    },
    MEDIA_BUCKET: { check: isBucket, message: 'Informe o nome do bucket S3 de mídia.' },
    AWS_REGION: {
      check: isRegion,
      message: 'Informe a região AWS; na Lambda esse valor vem do runtime.',
    },
  };
  if (operation === 'stream') {
    rules.MEDIA_DOMAIN = {
      check: isHostname,
      message: 'Informe o hostname CloudFront sem esquema nem caminho.',
    };
    rules.SIGNING_PARAMETER_ARN = {
      check: isParameterArn,
      message: 'Informe o ARN do segredo de assinatura.',
    };
    rules.CLOUDFRONT_KEY_ID = {
      check: (value) => /^[a-zA-Z0-9]{1,128}$/.test(value),
      message: 'Informe o ID da chave pública CloudFront.',
    };
  } else if (['list', 'start', 'parts', 'complete', 'abort'].includes(operation)) {
    rules.TICKET_PARAMETER_ARN = {
      check: isParameterArn,
      message: 'Informe o ARN do segredo HMAC de tickets.',
    };
  }
  const issues = validateFields({ ...env, OPERATION: operation }, rules);
  const appEnv = env.APP_ENV ?? 'production';
  if (!['production', 'acceptance'].includes(appEnv))
    issues.push({ name: 'APP_ENV', message: 'Use production ou acceptance.' });
  if (!isIntegerIn(env.MAX_UPLOAD_BYTES ?? String(MAX_UPLOAD_BYTES), 1, MAX_UPLOAD_BYTES))
    issues.push({ name: 'MAX_UPLOAD_BYTES', message: 'Use inteiro de 1 a 21474836480 bytes.' });
  return issues;
}
export function assertValid(issues) {
  if (issues.length)
    throw new Error(issues.map((issue) => `${issue.name}: ${issue.message}`).join('\n'));
}
