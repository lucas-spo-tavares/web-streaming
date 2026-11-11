# Implantação e operação

## Deploy completo

Na raiz do projeto, com dependências instaladas e `.env.deploy` preenchido:

```sh
npm run deploy
```

O comando executa `deploy:back` e depois `deploy:front`, parando se qualquer etapa falhar. Ambos carregam `.env.deploy` automaticamente e preservam a prioridade das variáveis já exportadas.

- `npm run deploy:back`: valida o ambiente, compila o backend, inicializa e valida o Terraform aplica toda a infraestrutura com `-auto-approve`, sem confirmação interativa, e inicializa os parâmetros secretos ainda pendentes.
- `npm run deploy:front`: gera a configuração pública pelos outputs Terraform, valida e compila o front, envia os assets ao S3, publica o HTML sem cache e solicita a invalidação do CloudFront. Assets anteriores são preservados para rollback. A propagação da invalidação é assíncrona.

O comando completo aplica mudanças na conta AWS configurada e pode gerar custos. Para revisar o plano antes de aplicar, use as etapas manuais abaixo. No primeiro provisionamento, configurar `ACERVO_SIGNING_PRIVATE_KEY_PATH`: o deploy inicializa os segredos automaticamente após o apply. Valores existentes são preservados e deploys seguintes dispensam o arquivo privado. A criação do proprietário continua na etapa específica deste guia. Em um deploy existente com Secrets Manager, seguir primeiro a seção de migração antes do deploy completo.

## Preparar o ambiente

Requer conta AWS, AWS CLI v2 autenticado por perfil/SSO ou role, Node.js 22.16+, npm, Terraform 1.11+ e OpenSSL. Consulte [variáveis de ambiente](environment.md) para nomes, obrigatoriedade, defaults, origem e precedência. Os exemplos abaixo partem da raiz do projeto; o launcher não expande shell dentro de argumentos e não executa outras etapas automaticamente.

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

Os comandos seguintes são executados manualmente. Não há pipeline de CI nem configuração de state remoto. Os scripts npm automatizam as mesmas etapas locais.

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

No primeiro provisionamento, inserir segredos diretamente no Parameter Store:

```sh
npm run env:check -- --target deploy --stage secrets --file .env.deploy
node scripts/with-env.mjs .env.deploy node --experimental-strip-types scripts/init-secrets.mjs
```

O script usa `ACERVO_SIGNING_PRIVATE_KEY_PATH` e mantém compatibilidade com argumento posicional explícito, que tem prioridade. Ele nunca imprime valores de segredos. Ele preenche apenas os marcadores do primeiro setup e preserva segredos já inicializados. Terraform cria parâmetros `SecureString`, no nível `Standard`, usando `alias/aws/ssm` e um marcador via `value_wo` (Terraform 1.11+), sem persistir valores secretos no state/outputs. Não alterar `value_wo_version` durante deploys: isso repõe o marcador. A Lambda recusa parâmetros ainda não inicializados. O perfil de setup precisa de `ssm:GetParameter` e `ssm:PutParameter` nesses parâmetros.

## Migração de um deploy com Secrets Manager

Os nomes das referências mudaram para `TICKET_PARAMETER_ARN` / `SIGNING_PARAMETER_ARN` e os outputs para `ticket_parameter_arn` / `signing_parameter_arn`. Reconstruir o backend antes do plano para incluir o cliente SSM.

Se já existem segredos em produção, copiar seus valores para os novos parâmetros `SecureString` antes de direcionar as Lambdas para eles, em duas etapas de infraestrutura. Primeiro criar apenas os parâmetros com um plano direcionado (`-target=aws_ssm_parameter.ticket -target=aws_ssm_parameter.signing`), sem atualizar as funções. Transferir os valores com SDK em memória, sem imprimir conteúdo nem passá-lo por argumentos do shell. Depois revisar e aplicar o plano completo com as novas permissões e referências. Preservar a mesma chave HMAC mantém tickets/cursores válidos. A inicialização com chave HMAC nova invalida esses tokens.

O plano completo agenda a exclusão dos recursos antigos do Secrets Manager com janela de recuperação de sete dias. Conferir a cópia antes de aplicar. Parâmetros gerenciados pelo recurso SSM usam `value_wo`; não importar como `value`, pois isso pode trazer o segredo para o state.

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

O login usa `USER_AUTH` com `EMAIL_OTP` na própria página, sem senha ou redirecionamento. A validade dos tokens é controlada pelo Cognito: o app client configura access tokens de 15 minutos e refresh tokens de 1 dia. Access token, refresh token e vencimentos são persistidos no `localStorage`, em uma chave específica da região e do app client Cognito. O front calcula o vencimento com `ExpiresIn`, retornado pelo Cognito em cada autenticação/refresh, e renova os tokens ao abrir/recarregar a aplicação, ao expirar e após uma resposta 401. Requisições simultâneas compartilham a renovação em andamento; cada requisição com 401 é repetida no máximo uma vez. Não há limite de duração fixo no front: a sessão pode ser renovada enquanto o Cognito aceitar o refresh token. Falhas temporárias de conexão preservam a sessão para uma nova tentativa; refresh token expirado/revogado ou um segundo 401 retornam ao login. Logout remove a sessão persistida e revoga o refresh token. O desafio OTP fica somente em memória. Sessões salvas pela versão anterior, sem refresh token, exigem novo login.

Para usuários já existentes, conferir email verificado, status compatível com login passwordless e grupo `owners`. Um usuário criado anteriormente com senha temporária e status `FORCE_CHANGE_PASSWORD` precisa de ajuste administrativo; não apagar e recriar contas automaticamente. O pool permite o fator PASSWORD para compatibilidade, mas a interface só oferece OTP.

A configuração de domínio/login hospedado anterior permanece no Terraform para evitar remoções desnecessárias durante a migração; a aplicação não a utiliza. `TF_VAR_local_front_origin` continua necessário para CORS local.

## Publicar front

Depois do apply, gerar a configuração pública e reconstruir. O gerador usa apenas a allowlist de três `VITE_*`, sem copiar o ambiente de deploy para o browser.

```sh
node scripts/with-env.mjs .env.deploy node --experimental-strip-types scripts/write-front-env.mjs
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

## Retenção renovável e download

O Terraform cria `${TF_VAR_name}-retention` no DynamoDB com cobrança por demanda e PITR desativado, além de uma Lambda `cleanup` acionada pelo EventBridge a cada hora. A tabela guarda apenas prazos renovados e marcadores de exclusão. Vídeos existentes sem registro continuam com o prazo inicial de 30 dias a partir de `LastModified`; não há cópia ou migração dos arquivos.

O deploy remove a expiração fixa de objetos do Lifecycle S3, mantendo o aborto de multipart incompleto. Esse ajuste deve ser aplicado junto das Lambdas: manter a regra antiga apagaria vídeos apesar da renovação. As funções dependem da atualização do Lifecycle antes de serem atualizadas. A limpeza usa escritas condicionais no DynamoDB para coordenar renovações com exclusões. Marcadores de exclusão são descartados por TTL após sete dias; TTL não exclui os vídeos.

Listagem, streaming e download leem o mesmo vencimento. A exclusão física ocorre na execução da limpeza após o vencimento e pode levar mais tempo em caso de falha; verificar erros da Lambda `cleanup` no CloudWatch. A permissão `s3:GetObject` da Lambda de download assina links temporários com resposta de download; os dados não passam pela Lambda.

## Rotação de chaves

1. Gerar novo par RSA e adicionar nova chave pública ao key group mantendo a anterior.
2. Inserir nova chave privada no Parameter Store pelo SDK/CLI com arquivo seguro (`aws ssm put-parameter --name /NOME/cloudfront-private-key --type SecureString --tier Standard --key-id alias/aws/ssm --overwrite --value file:///caminho/seguro/nova-private.pem`, substituindo `NOME` pelo nome do projeto) sem imprimir o conteúdo; atualizar `CLOUDFRONT_KEY_ID` das Lambdas para a nova chave pública.
3. Aguardar propagação e conferir um link novo. O cache de segredos na Lambda dura até cinco minutos; atualizar configuração reinicia os ambientes da função.
4. Manter a chave pública anterior por pelo menos quatro horas após a última URL assinada com ela, mais margem de propagação, antes de removê-la.

A configuração inicial tem uma chave; a rotação requer uma atualização Terraform coordenada do conjunto de chaves. Não substituir diretamente uma chave confiável se links anteriores ainda precisarem funcionar. Não há revogação individual de links nesta versão.

## Custos, logs e rollback

Custos incluem armazenamento e partes incompletas S3, solicitações S3/CloudFront, tráfego de saída de vídeos, Cognito Essentials, invocações Lambda/API Gateway, leituras e escritas DynamoDB, agendamento EventBridge e CloudWatch. O Parameter Store Standard com throughput padrão não cobra armazenamento nem chamadas; operações de criptografia do KMS podem gerar cobrança. Não habilitar Advanced ou maior throughput sem revisar os custos. Não há valores fixos estimados; dependem de região, volume e uso. Busca sem índice percorre páginas e pode aumentar solicitações. Logs têm retenção de 14 dias, registram operação/status/correlation id e não registram URLs assinadas, tokens, tickets ou query strings de mídia.

Preservar `front/dist`, `back/dist/handler.cjs` e lockfiles da versão publicada em armazenamento de releases. Para rollback de front, publicar build anterior e invalidar index; para backend, restaurar bundle anterior e aplicar plano que só atualize funções. Não usar `terraform destroy` como rollback. Buckets têm `prevent_destroy`/`force_destroy=false`; pool Cognito tem proteção de exclusão. Vídeos removidos pela limpeza ou pelo botão Excluir não são recuperáveis nesta versão sem versionamento. Não restaurar a expiração fixa do Lifecycle durante um rollback enquanto houver vídeos com prazo renovado.

### Encurtador e tags

A API key do encurtador fica no SecureString `/<name>/short-link-api-key`, junto aos outros
segredos. No primeiro setup, forneça `ACERVO_SHORT_LINK_API_KEY` ao ambiente de
`scripts/init-secrets.mjs`. Valores já inicializados são preservados. O output
`short_link_parameter_arn` contém apenas a referência. Somente a função `short` tem permissão
para ler essa chave. Os dois providers aplicam a tag `web-streaming=true` aos recursos que
aceitam tags; a tag `Project` foi removida.
