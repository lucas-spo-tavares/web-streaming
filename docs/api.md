# API

Base URL: output `frontend_config.VITE_API_URL`. Todas as rotas exigem `Authorization: Bearer <access_token>` emitido pelo Cognito, client ID do app client e grupo `owners`. ID token não é aceito. O front obtém o token com `USER_AUTH`/`EMAIL_OTP` na própria página. O API Gateway verifica assinatura, issuer, client ID e expiração; a Lambda valida acesso de proprietário e isolamento da operação.

| Método e rota            | Entrada                                                                                     | Saída 200                                 |
| ------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `GET /files?q=&cursor=`  | `q` opcional, substring case-insensitive; cursor opcional vinculado ao termo e proprietário | `{files, nextCursor, serverNow}`          |
| `POST /uploads`          | `{name, size, contentType?}`                                                                | `{ticket, partSize, partCount, maxBytes}` |
| `POST /uploads/parts`    | `{ticket, partNumbers: [1, ...]}` até dez números únicos                                    | `{parts: [{partNumber, url}]}`            |
| `POST /uploads/complete` | `{ticket, parts: [{partNumber, etag}]}`                                                     | `{file}`                                  |
| `POST /uploads/abort`    | `{ticket}`                                                                                  | `{aborted: true}`                         |
| `POST /stream-links`     | `{key}`                                                                                     | `{url, expiresAt, serverNow}`             |

Arquivo: `{key, name, size, createdAt, expiresAt, expired}`. Datas ISO 8601 UTC, tamanho em bytes. A interface converte datas para horário local e usa `serverNow` para compensar diferença de relógio.

A busca normaliza espaços nas extremidades e caixa. Consulta vazia lista todos os objetos válidos do app. Até 100 objetos S3 são examinados por resposta. Uma página pode estar vazia com `nextCursor` presente: isso significa continuar a busca, não ausência definitiva. Ao alterar `q`, descartar o cursor antigo. Paginação não é snapshot; uploads e exclusões concorrentes podem mudar a biblioteca. Não há ordenação por data garantida.

O ticket é opaco e autenticado por HMAC. Nunca alterar seus campos. O backend vincula chave, usuário, uploadId, tamanho, partes e vencimento, e confirma os tamanhos/ETags no S3 antes de completar. O S3 recebe somente as partes; a finalização passa pela API. A repetição de conclusão retorna o mesmo objeto após conferir metadados da sessão e tamanho, sem sobrescrever dados. Não remover aspas dos ETags recebidos pelo browser.

Erros JSON: `{code, message, requestId}`. Status: 400 entrada inválida; 401 sessão inválida; 403 sem autorização; 404 objeto/operação ausente; 409 sessão de upload vencida ou partes inconsistentes; 410 arquivo expirado; 413 limite excedido; 503 falha temporária. Respostas usam `Cache-Control: no-store` e `x-request-id`. URLs, tickets, tokens e mensagens internas AWS não são registrados nos logs.
