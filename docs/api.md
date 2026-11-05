# API

Base URL: output `frontend_config.VITE_API_URL`. Todas as rotas exigem `Authorization: Bearer <access_token>` emitido pelo Cognito, client ID do app client e grupo `owners`. ID token não é aceito. O front obtém o token com `USER_AUTH`/`EMAIL_OTP` na própria página. O API Gateway verifica assinatura, issuer, client ID e expiração; a Lambda valida acesso de proprietário e isolamento da operação.

| Método e rota            | Entrada                                                                                     | Saída 200                                 |
| ------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `GET /files?q=&cursor=`  | `q` opcional, substring case-insensitive; cursor opcional vinculado ao termo e proprietário | `{files, nextCursor, serverNow}`          |
| `DELETE /files`          | `{key}`                                                                                     | `{deleted: true}`                         |
| `POST /uploads`          | `{name, size, contentType?}`                                                                | `{ticket, partSize, partCount, maxBytes}` |
| `POST /uploads/parts`    | `{ticket, partNumbers: [1, ...]}` até dez números únicos                                    | `{parts: [{partNumber, url}]}`            |
| `POST /uploads/complete` | `{ticket, parts: [{partNumber, etag}]}`                                                     | `{file}`                                  |
| `POST /uploads/abort`    | `{ticket}`                                                                                  | `{aborted: true}`                         |
| `POST /files/renew`      | `{key}`                                                                                     | `{file, serverNow}`                       |
| `POST /download-links`   | `{key}`                                                                                     | `{url, expiresAt, serverNow}`             |
| `POST /stream-links`     | `{key}`                                                                                     | `{url, expiresAt, serverNow}`             |

Arquivo: `{key, name, size, createdAt, expiresAt, expired}`. Datas ISO 8601 UTC, tamanho em bytes. A interface converte datas para horário local e usa `serverNow` para compensar diferença de relógio.

A busca normaliza espaços nas extremidades e caixa. Consulta vazia lista todos os objetos válidos do app. Até 100 objetos S3 são examinados por resposta. Uma página pode estar vazia com `nextCursor` presente: isso significa continuar a busca, não ausência definitiva. Ao alterar `q`, descartar o cursor antigo. Paginação não é snapshot; uploads e exclusões concorrentes podem mudar a biblioteca. Não há ordenação por data garantida.

Uploads aceitam somente extensões de vídeo suportadas e MIME compatível. Extensões aceitas: `.mp4`, `.m4v`, `.webm`, `.mov`, `.mkv`, `.avi`, `.mpeg`, `.mpg`, `.ogv`, `.ts`, `.mts`, `.m2ts`, `.3gp` e `.3g2`. Quando o navegador omite o MIME ou informa `application/octet-stream`, o backend infere o tipo pela extensão. Tipos incompatíveis e arquivos fora dessa lista retornam 400 antes de iniciar o multipart. Essa validação usa nome e tipo declarado; não analisa os bytes do vídeo.

O ticket é opaco e autenticado por HMAC. Nunca alterar seus campos. O backend vincula chave, usuário, uploadId, tamanho, partes e vencimento, e confirma os tamanhos/ETags no S3 antes de completar. O S3 recebe somente as partes; a finalização passa pela API. A repetição de conclusão retorna o mesmo objeto após conferir metadados da sessão e tamanho, sem sobrescrever dados. Não remover aspas dos ETags recebidos pelo browser.

Erros JSON: `{code, message, requestId}`. Status: 400 entrada inválida; 401 sessão inválida; 403 sem autorização; 404 objeto/operação ausente; 409 sessão de upload vencida ou partes inconsistentes; 410 arquivo expirado; 413 limite excedido; 503 falha temporária. Respostas usam `Cache-Control: no-store` e `x-request-id`. URLs, tickets, tokens e mensagens internas AWS não são registrados nos logs.

A exclusão remove o objeto do bucket de mídia e é idempotente: repetir a mesma chave retorna sucesso mesmo se o arquivo já não existir. Apenas chaves válidas do aplicativo são aceitas. A interface pede confirmação e atualiza a listagem após sucesso. Objetos já presentes no cache do CloudFront podem continuar acessíveis por links assinados existentes até seu vencimento; a exclusão não gera invalidação do cache.

O front oferece `/watch/:fileName`, em que `fileName` é o nome completo do objeto S3 (UUID seguido de `--` e do nome original), codificado para URL. Isso distingue vídeos com nomes originais iguais. A página exige login e usa `POST /stream-links` para obter o endereço temporário do `<video controls>`. Ao abrir um link direto e autenticar, a rota é preservada. Não há transcodificação: formatos e codecs precisam ser compatíveis com o navegador; o link para VLC continua disponível na biblioteca.

Reiniciar a expiração define o prazo como 30 dias a partir do relógio do servidor, preservando o nome, o conteúdo, a chave e a data original de envio. Um objeto expirado ainda presente pode ser renovado até a limpeza iniciar sua exclusão; depois disso a API retorna 409 `DELETION_STARTED` ou 404. As renovações ficam na tabela DynamoDB; listagem, streaming e download usam o mesmo vencimento. Escritas condicionais impedem que uma limpeza baseada em uma listagem anterior apague um vídeo renovado.

O download gera uma URL pré-assinada S3 de até 15 minutos, limitada também ao vencimento do vídeo, com `Content-Disposition: attachment` e nome original codificado em UTF-8. Os bytes vão diretamente do S3 ao navegador. Não são geradas URLs novas para arquivos expirados ou ausentes; uma transferência já iniciada pode continuar. A renovação não altera o vencimento de links temporários já emitidos.

### POST /short-links

Recebe `{ "key": "<chave do vídeo>", "code": "stream" }`, com a mesma autenticação de proprietário.
O campo `code` é opcional: sem ele, gera um código aleatório; com ele, cria ou substitui o destino
do endereço fixo. Aceita de 1 a 64 caracteres `[a-z0-9_-]`, começando por letra ou número.
Gera um link assinado de streaming e envia sua URL a `POST https://link.lucas-tavares.com/links`,
com `expiresAt` igual ao vencimento do link assinado (até 4 horas, limitado pela retenção do vídeo)
e `code` quando informado. Os dois tipos enviam `maxAccesses: 5`, limitando o endereço curto a
5 acessos. Substituir um código fixo reinicia esse contador. A API key é lida do Parameter Store somente no backend.
Retorna `{ url, expiresAt, serverNow }`, com `url` encurtada e a mesma validade do link assinado.
Os botões **Gerar link aleatório** e **Gerar link fixo** geram e copiam o endereço.
O segundo abre um modal com `stream` preenchido e permite escolher outro código.
Listar, assistir e copiar o link original não chamam o encurtador. Códigos de outra chave retornam
409 `SHORT_LINK_CODE_UNAVAILABLE`. Outras falhas retornam 503 sem expor credenciais.
