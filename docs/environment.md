# Variáveis de ambiente

Execute os comandos na raiz do monorepo com Node.js 22.16+. Os arquivos reais são ignorados pelo Git. Exemplos têm placeholders que precisam ser substituídos; a validação de ambiente conectado não aceita cópias sem preenchimento.

| Exemplo versionado    | Arquivo local         | Uso                                                        |
| --------------------- | --------------------- | ---------------------------------------------------------- |
| `front/.env.example`  | `front/.env.local`    | Configuração pública carregada pelo Vite                   |
| `back/.env.example`   | `back/.env.local`     | Referência/validação de runtime Lambda, sem servidor local |
| `.env.deploy.example` | `.env.deploy` na raiz | Operador, Terraform e subprocessos de deploy               |

```sh
cp front/.env.example front/.env.local
cp back/.env.example back/.env.local
cp .env.deploy.example .env.deploy
```

Copie apenas os arquivos necessários à sua finalidade. Para compilar e abrir a tela desconectada, nenhum `.env` nem credencial AWS é necessário. As operações reais do app dependem de um ambiente implantado.

## Front

Todos os campos são **públicos**, obrigatórios para conectar o app e não possuem valor padrão. A fonte é o output `frontend_config` do Terraform.

| Variável         | Valor esperado                                                      |
| ---------------- | ------------------------------------------------------------------- |
| `VITE_API_URL`   | Origem HTTPS da API; HTTP só em loopback local para desenvolvimento |
| `VITE_CLIENT_ID` | Client ID público do app client sem segredo                         |

| `VITE_AWS_REGION` | Região do Cognito, por exemplo `sa-east-1` |

Depois de provisionar, `node scripts/write-front-env.mjs` gera `front/.env.local` usando somente esses três campos, com validação antes de substituir o arquivo. Outros outputs/segredos são descartados. Uma falha preserva a configuração anterior. Não colocar credenciais AWS, senha, conteúdo de chaves ou valores do Parameter Store em variáveis `VITE_*`.

```sh
npm run env:check -- --target front --file front/.env.local
npm run dev
```

O Vite carrega os arquivos do diretório `front/`. Variáveis já exportadas no processo têm prioridade, seguidas dos arquivos específicos do modo (`.env.[mode].local`, `.env.[mode]`), `.env.local` e `.env`. Não misture valores conflitantes. Reinicie o servidor após editar o ambiente. O build incorpora valores públicos: para mudar a configuração em produção, reconstruir e republicar. Uma configuração ausente ou inválida mantém a tela de configuração pendente, sem bypass de login.

O login usa `EMAIL_OTP` na própria página. O access token e seu vencimento são persistidos no `localStorage`, separados por região e app client Cognito. Recarregar mantém uma sessão válida. Expiração ou resposta 401 remove a sessão e retorna ao login, sem renovação automática. Desafio OTP e refresh token ficam somente em memória.

## Backend

`back/.env.local` serve para validação, sem iniciar API local. Na AWS, o Terraform injeta as variáveis e o runtime fornece `AWS_REGION`. ARNs são referências e não contêm o valor de segredos.

| Variável                | Obrigatória em     | Padrão/origem                                                                                                     | Sensibilidade         |
| ----------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------- |
| `OPERATION`             | Todas              | `list`, `start`, `parts`, `complete`, `abort`, `stream`, `delete`, `renew`, `download`, `cleanup`, pelo Terraform | Configuração          |
| `MEDIA_BUCKET`          | Todas              | Bucket criado pelo Terraform                                                                                      | Configuração          |
| `RETENTION_TABLE`       | Todas              | Tabela `${TF_VAR_name}-retention` criada pelo Terraform                                                           | Configuração          |
| `AWS_REGION`            | Todas              | Runtime Lambda ou região exportada fora dele                                                                      | Configuração          |
| `TICKET_PARAMETER_ARN`  | Listagem e uploads | Output `ticket_parameter_arn`                                                                                     | Referência ao segredo |
| `MEDIA_DOMAIN`          | Streaming          | Output `media_domain`, hostname sem esquema/path                                                                  | Público               |
| `SIGNING_PARAMETER_ARN` | Streaming          | Output `signing_parameter_arn`                                                                                    | Referência ao segredo |
| `CLOUDFRONT_KEY_ID`     | Streaming          | ID da chave pública no recurso Terraform CloudFront                                                               | Público               |
| `APP_ENV`               | Opcional           | `production`; alternativa `acceptance`                                                                            | Configuração          |
| `MAX_UPLOAD_BYTES`      | Opcional           | `21474836480` (20 GiB), inteiro entre 1 e esse limite                                                             | Configuração          |

Chave privada e segredo HMAC são lidos diretamente do Parameter Store, nunca de `VITE_*`. A listagem não exige campos de streaming. As operações `delete`, `renew`, `download` e `cleanup` não exigem referências a segredos.

```sh
npm run env:check -- --target backend --file back/.env.local
npm run env:check -- --target backend --file back/.env.local --operation stream
```

`--operation` substitui somente a operação durante a validação; não altera o arquivo nem a Lambda.

## Deploy

O launcher não inicia deploy automaticamente. Ele carrega o arquivo e executa o programa/argumentos explicitamente solicitados, sem shell. Caminhos com espaços funcionam quando passados como um argumento entre aspas.

```sh
npm run env:check -- --target deploy --file .env.deploy
node scripts/with-env.mjs .env.deploy terraform -chdir=infra plan
```

| Variável                          | Obrigatória/padrão             | Origem e finalidade                                    | Sensibilidade                                 |
| --------------------------------- | ------------------------------ | ------------------------------------------------------ | --------------------------------------------- |
| `AWS_REGION`                      | Obrigatória por stage          | Região da aplicação, exemplo `sa-east-1`               | Configuração                                  |
| `AWS_PROFILE`                     | Opcional                       | Perfil/SSO local; omitir quando usar role/CI           | Identificador local                           |
| `TF_VAR_name`                     | Infraestrutura                 | Nome único, 3–30 caracteres minúsculos, números/hífens | Configuração                                  |
| `TF_VAR_region`                   | Padrão `sa-east-1`             | Igual a `AWS_REGION` no fluxo de aplicação             | Configuração                                  |
| `TF_VAR_environment`              | Padrão `production`            | Alternativa `acceptance`                               | Configuração                                  |
| `TF_VAR_signing_public_key_path`  | Infraestrutura                 | Arquivo **público** PEM RSA 2048 existente e legível   | Chave pública                                 |
| `TF_VAR_local_front_origin`       | Padrão `http://localhost:5173` | Callback/CORS local                                    | Configuração                                  |
| `TF_VAR_max_upload_bytes`         | Padrão `21474836480`           | Inteiro 1–21474836480                                  | Configuração                                  |
| `ACERVO_OWNER_EMAIL`              | Somente stage owner            | Email para criação administrativa Cognito              | Dado pessoal                                  |
| `ACERVO_SIGNING_PRIVATE_KEY_PATH` | Somente stage secrets          | Caminho local da chave privada de primeiro setup       | Caminho privado; conteúdo secreto fora do env |

Validação é offline: verifica estrutura, formatos e arquivos locais; não garante existência remota do bucket, disponibilidade dos nomes, validade da sessão AWS ou permissões. Nenhum ID de recurso é exigido antes do primeiro provisionamento.

As validações por stage permitem preparar as etapas separadamente:

```sh
npm run env:check -- --target deploy --stage infrastructure --file .env.deploy
npm run env:check -- --target deploy --stage owner --file .env.deploy
npm run env:check -- --target deploy --stage secrets --file .env.deploy
```

`infrastructure` é o padrão e valida inputs Terraform; `owner` verifica região e email; `secrets` verifica região e o arquivo privado local. Nesses stages posteriores, o Terraform já precisa estar inicializado na máquina que mantém `infra/terraform.tfstate`.

### Domínio do front

`TF_VAR_hosted_zone_name` usa `lucas-tavares.com` por padrão e seleciona uma zona pública Route 53 já existente. `TF_VAR_frontend_domain_name` usa `streaming.lucas-tavares.com` por padrão e deve ser um subdomínio dessa zona. Ambos são opcionais quando esses padrões forem usados. O Terraform cria um certificado ACM dedicado ao front em `us-east-1`, com validação DNS, e aliases A/AAAA para CloudFront. Não é necessário fornecer ARN de certificado nem modificar o certificado do portfolio. O output `frontend_url` informa a URL personalizada; `frontend_cloudfront_url` preserva o endereço padrão da distribuição.

### Autenticação AWS

Use a cadeia padrão do AWS CLI/SDK/Terraform: profile/SSO com `AWS_PROFILE`, identidade do ambiente ou role de CI. `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e `AWS_SESSION_TOKEN` podem ser fornecidos externamente como credenciais temporárias; `AWS_ROLE_ARN` e `AWS_WEB_IDENTITY_TOKEN_FILE` são usados quando o ambiente oferece identidade federada. Não são obrigatórios nos exemplos e seus valores não devem ser versionados ou prefixados com `VITE_`. O validador não lê arquivos de credenciais nem consulta STS.

### Precedência e diretórios

`with-env.mjs` e `env:check --file` usam parsing dotenv nativo: variáveis do processo prevalecem sobre o arquivo. Não há expansão de `$VAR`, `${VAR}`, `$(comando)` ou crases. O launcher herda as credenciais externas sem imprimir seu ambiente. Para usar uma variável num argumento, faça isso dentro do processo filho; os exemplos de [implantação](deployment.md) usam Node/`execFileSync` sem shell.

O launcher resolve o arquivo a partir do diretório atual e não muda o cwd. Execute-o na raiz. Terraform recebe `TF_VAR_*` porque herda o processo; `.env.deploy` não é carregado diretamente pelo Terraform. `-chdir=infra` faz caminhos Terraform relativos apontarem para `infra/`; prefira caminho absoluto da chave pública. O caminho privado usado pelo script de segredos é relativo à raiz do comando.

O state fica localmente em `infra/terraform.tfstate`, fora do Git. Não há variáveis de bucket/key de state nem pipeline de deploy. Execute `terraform -chdir=infra init` e mantenha uma cópia segura do state.

A precedência nativa do Terraform continua valendo: `-var`/`-var-file`, arquivos tfvars automáticos e `terraform.tfvars` podem sobrescrever `TF_VAR_*`. O validador de ambiente avalia o arquivo/processo, não interpreta tfvars. Escolha uma fonte por execução para não validar uma região e implantar outra. Configuração por tfvars continua suportada diretamente pelo Terraform; a validação de `.env.deploy` exige seus inputs nesse arquivo/processo.

### Valores depois do provisionamento

`ACERVO_POOL_ID`, `ACERVO_FRONT_BUCKET` e `ACERVO_FRONT_DISTRIBUTION` são nomes usados no guia para valores derivados dos outputs `user_pool_id`, `frontend_bucket` e `front_distribution_id`. Os ARNs e o hostname de mídia também vêm dos outputs. Não preencher antecipadamente no exemplo de deploy. `frontend_config` alimenta as três variáveis públicas do front após a criação da infraestrutura.

## Verificações seguras

`env:check` lista nomes de variáveis e orientações, nunca seus valores. Exemplos incompletos devem falhar; isso não impede `npm run check` offline. Para exercitar o launcher sem executar operações remotas:

```sh
node scripts/with-env.mjs .env.deploy node -e 'if (!process.env.TF_VAR_name) process.exitCode = 1'
```

A configuração de ambiente não altera as regras de retenção de 30 dias nem os links de até quatro horas.
