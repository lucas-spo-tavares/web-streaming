# Implantação e operação

## Preparar o ambiente

Requer conta AWS, AWS CLI v2 autenticado por perfil/SSO ou role, Node.js 22.16+, npm, Terraform e OpenSSL. Consulte [variáveis de ambiente](environment.md) para nomes, obrigatoriedade, defaults, origem e precedência. Os exemplos abaixo partem da raiz do projeto; o launcher não expande shell dentro de argumentos e não executa outras etapas automaticamente.

Copiar `.env.deploy.example` para `.env.deploy` e substituir seus placeholders. Usar `AWS_REGION` igual a `TF_VAR_region`. Não preencher IDs de recursos que só existirão depois do primeiro apply. Evitar valores conflitantes em `infra/terraform.tfvars` e `TF_VAR_*`; a alternativa via tfvars continua suportada diretamente pelo Terraform.

Gerar um par RSA em diretório seguro fora do projeto e apontar `TF_VAR_signing_public_key_path` para o arquivo público e `ACERVO_SIGNING_PRIVATE_KEY_PATH` para o privado. Usar caminhos absolutos. Exemplo de geração, sem executar deploy:

```sh
umask 077
mkdir -p /tmp/acervo-key-setup
openssl genrsa -out /tmp/acervo-key-setup/private.pem 2048
openssl rsa -in /tmp/acervo-key-setup/private.pem -pubout -out /tmp/acervo-key-setup/public.pem
cp .env.deploy.example .env.deploy
```

Guardar a chave privada com segurança fora de `/tmp` após setup e não versionar seu conteúdo. Nenhum segredo é fornecido como input Terraform; ele recebe apenas a chave pública.

## Subdomínio e HTTPS

O padrão é `streaming.lucas-tavares.com`, na zona pública Route 53 existente `lucas-tavares.com`, como no projeto portfolio. O Terraform adiciona aliases A e AAAA para a distribuição do front e cria um certificado ACM dedicado em `us-east-1`, validado por um registro DNS na mesma zona. O certificado do portfolio permanece sob responsabilidade do outro projeto.

A role de deploy precisa ler a zona e gerenciar os novos registros Route 53 e o certificado ACM em `us-east-1`, além das permissões anteriores. O subdomínio precisa estar disponível; registros existentes não são sobrescritos automaticamente. Depois do apply, aguardar propagação DNS/CloudFront. `frontend_url` retorna a URL personalizada, e Cognito/CORS recebem essa origem junto das origens local e padrão CloudFront. Os vídeos continuam na distribuição privada de mídia.

## State local e deploy manual

O Terraform usa seu backend local padrão, sem bloco de backend adicional e sem bucket de state. Inicialize na raiz do projeto:

```sh
node scripts/with-env.mjs .env.deploy terraform -chdir=infra init
```

Após o apply, o arquivo fica em `infra/terraform.tfstate`; seu backup fica em `infra/terraform.tfstate.backup`. Ambos são ignorados pelo Git. Preserve uma cópia segura para manter o controle dos recursos caso troque de máquina ou perca o diretório local.

Os comandos seguintes são executados manualmente. Não há pipeline de deploy nem configuração de state remoto.

## Infraestrutura

```sh
npm ci
npm run check
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate
npm run env:check -- --target deploy --file .env.deploy
node scripts/with-env.mjs .env.deploy terraform -chdir=infra plan -out=production.tfplan
```

O launcher preserva variáveis já exportadas, incluindo credenciais temporárias de CI, em vez de exigir chaves estáticas em arquivo. A validação não consulta AWS nem garante permissões. Revisar plano, conta e região antes da etapa abaixo, que provisiona recursos e gera custos:

```sh
node scripts/with-env.mjs .env.deploy terraform -chdir=infra apply production.tfplan
```

No primeiro provisionamento, inserir segredos diretamente no Secrets Manager:

```sh
npm run env:check -- --target deploy --stage secrets --file .env.deploy
node scripts/with-env.mjs .env.deploy node scripts/init-secrets.mjs
```

O script usa `ACERVO_SIGNING_PRIVATE_KEY_PATH` e mantém compatibilidade com argumento posicional explícito, que tem prioridade. Ele nunca imprime valores de segredos. **Não executar em todo deploy**: uma nova chave HMAC invalida tickets/cursores ativos. Terraform gerencia apenas os recursos vazios do Secrets Manager, sem valores em state/outputs.

## Proprietário e login OTP

Preencher `ACERVO_OWNER_EMAIL` e provisionar administrativamente. O pool vem de output, sem precisar ser adivinhado antes do apply; o usuário é criado sem senha após habilitar EMAIL_OTP no pool:

```sh
npm run env:check -- --target deploy --stage owner --file .env.deploy
node scripts/with-env.mjs .env.deploy node --input-type=module -e '
import { execFileSync } from "node:child_process";
const pool = execFileSync("terraform", ["-chdir=infra", "output", "-raw", "user_pool_id"], {encoding:"utf8"}).trim();
const email = process.env.ACERVO_OWNER_EMAIL;
execFileSync("aws", ["cognito-idp", "admin-create-user", "--user-pool-id", pool, "--username", email, "--user-attributes", "Name=email,Value=" + email, "Name=email_verified,Value=true", "--message-action", "SUPPRESS"], {stdio:"inherit"});
execFileSync("aws", ["cognito-idp", "admin-add-user-to-group", "--user-pool-id", pool, "--username", email, "--group-name", "owners"], {stdio:"inherit"});
'
```

Cadastro público permanece desabilitado. O usuário informa o email na própria página e confirma o código recebido. O fluxo usa `USER_AUTH`/`EMAIL_OTP`, sem redirecionamento, senha ou cookies da aplicação. Tokens e desafio ficam em memória; recarregar exige novo código. Logout limpa a sessão local e revoga o refresh token; access tokens e URLs emitidas seguem o próprio vencimento.

Para usuários já existentes, conferir email verificado, status compatível com login passwordless e grupo `owners`. Um usuário criado anteriormente com senha temporária e status `FORCE_CHANGE_PASSWORD` precisa de ajuste administrativo; não apagar e recriar contas automaticamente. O pool permite o fator PASSWORD para compatibilidade, mas a interface só oferece OTP.

A configuração de domínio/login hospedado anterior permanece no Terraform para evitar remoções desnecessárias durante a migração; a aplicação não a utiliza. `TF_VAR_local_front_origin` continua necessário para CORS local.

## Publicar front

Depois do apply, gerar a configuração pública e reconstruir. O gerador usa apenas a allowlist de três `VITE_*`, sem copiar o ambiente de deploy para o browser.

```sh
node scripts/with-env.mjs .env.deploy node scripts/write-front-env.mjs
npm run env:check -- --target front --file front/.env.local
npm run build
node scripts/with-env.mjs .env.deploy node --input-type=module -e '
import { execFileSync } from "node:child_process";
const output = name => execFileSync("terraform", ["-chdir=infra", "output", "-raw", name], {encoding:"utf8"}).trim();
const bucket = output("frontend_bucket"), distribution = output("front_distribution_id");
execFileSync("aws", ["s3", "sync", "front/dist/", "s3://" + bucket + "/", "--exclude", "index.html", "--cache-control", "public,max-age=31536000,immutable"], {stdio:"inherit"});
execFileSync("aws", ["s3", "cp", "front/dist/index.html", "s3://" + bucket + "/index.html", "--cache-control", "no-cache,no-store,must-revalidate", "--content-type", "text/html"], {stdio:"inherit"});
execFileSync("aws", ["cloudfront", "create-invalidation", "--distribution-id", distribution, "--paths", "/index.html", "/", "/callback"], {stdio:"inherit"});
console.log(output("frontend_url"));
'
```

O sync preserva assets antigos para rollback. Apenas o front tem fallback SPA; a mídia exige assinatura inclusive em cache, com origem S3 privada. Upload usa PUT direto e CORS com ETag exposto. Links para o VLC não precisam de JWT/cookies do browser.

## Rotação de chaves

1. Gerar novo par RSA e adicionar nova chave pública ao key group mantendo a anterior.
2. Inserir nova chave privada no Secrets Manager pelo SDK/CLI com arquivo seguro (`--secret-string file:///caminho/seguro/nova-private.pem`) sem imprimir o conteúdo; atualizar `CLOUDFRONT_KEY_ID` das Lambdas para a nova chave pública.
3. Aguardar propagação e conferir um link novo. O cache de segredos na Lambda dura até cinco minutos; atualizar configuração reinicia os ambientes da função.
4. Manter a chave pública anterior por pelo menos quatro horas após a última URL assinada com ela, mais margem de propagação, antes de removê-la.

A configuração inicial tem uma chave; a rotação requer uma atualização Terraform coordenada do conjunto de chaves. Não substituir diretamente uma chave confiável se links anteriores ainda precisarem funcionar. Não há revogação individual de links nesta versão.

## Custos, logs e rollback

Custos incluem armazenamento e partes incompletas S3, solicitações S3/CloudFront, tráfego de saída de vídeos, Cognito Essentials, invocações Lambda/API Gateway, Secrets Manager e CloudWatch. Não há valores fixos estimados; dependem de região, volume e uso. Busca sem índice percorre páginas e pode aumentar solicitações. Logs têm retenção de 14 dias, registram operação/status/correlation id e não registram URLs assinadas, tokens, tickets ou query strings de mídia.

Preservar `front/dist`, `back/dist/handler.cjs` e lockfiles da versão publicada em armazenamento de releases. Para rollback de front, publicar build anterior e invalidar index; para backend, restaurar bundle anterior e aplicar plano que só atualize funções. Não usar `terraform destroy` como rollback. Buckets têm `prevent_destroy`/`force_destroy=false`; pool Cognito tem proteção de exclusão. Arquivos removidos pelo Lifecycle não são recuperáveis nesta versão sem versionamento.
