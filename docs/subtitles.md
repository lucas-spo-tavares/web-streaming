# Vídeos em pastas e legendas extraídas

Cada upload recebe um UUID e uma pasta própria no bucket privado de mídia:

```text
<uuid>/
├── Nome original.mkv
├── tracks.json
├── 2-por.srt
└── 2-por.vtt
```

A chave do vídeo é `<uuid>/<nome-original>`. Apenas chaves desse formato com extensão de vídeo válida aparecem na biblioteca. `tracks.json`, SRT e VTT não são vídeos. Nomes repetidos ficam em UUIDs diferentes. Não há compatibilidade com o formato anterior `<uuid>--<nome>`, pois a biblioteca foi esvaziada antes desta mudança.

## Extração

O término do upload multipart no S3 dispara uma Lambda separada em Python 3.13. Ela usa uma Layer própria com FFmpeg e FFprobe, construída sobre Amazon Linux 2023 para **x86_64**. As Lambdas existentes da API continuam em Node/arm64. A imagem Docker serve somente para construir e testar os executáveis localmente; a implantação utiliza ZIPs, sem ECR e sem guardar o ZIP em bucket.

O FFprobe identifica as faixas. O FFmpeg faz uma passagem pelo vídeo para produzir SRT e WebVTT para todas as faixas de texto compatíveis. O vídeo original permanece intacto, sem transcodificação de áudio ou vídeo. A entrada é uma URL S3 temporária, para não precisar copiar vídeos de até 20 GiB para `/tmp`. Isso ainda pode transferir o arquivo inteiro do S3 para a Lambda.

O worker usa até 15 minutos, 1 GiB de memória e concorrência reservada de duas execuções. São aceitas até 32 faixas, com até 2 MiB por arquivo de legenda. O tempo de FFmpeg reserva 30 segundos para publicar os resultados. As pastas temporárias são removidas ao terminar, inclusive em falhas.

Faixas SubRip, ASS/SSA, WebVTT, mov_text e texto são convertidas. ASS/SSA perdem estilos, posicionamentos e fontes ao virar SRT/WebVTT. PGS, VobSub e outros formatos em imagem são listados como não suportados; não há OCR.

O `tracks.json` informa `status` (`processing`, `ready` ou `failed`), a chave e o ETag do vídeo e os idiomas/faixas disponíveis. O número é o índice de stream do FFmpeg, começando em zero, e diferencia várias faixas do mesmo idioma. Faixas sem idioma declarado usam `und`.

Notificações repetidas encontram o resultado pronto ou compartilham a extração em andamento. A primeira gravação do manifesto é condicional no S3; uma falha pode ser repetida pela política de retry da Lambda, e uma tentativa que excedeu 15 minutos pode ser retomada por uma nova notificação. A notificação configurada ouve somente `ObjectCreated:CompleteMultipartUpload`; as saídas usam `PutObject`. O wrapper também rejeita JSON/SRT/VTT, evitando invocar a extração a partir dos próprios resultados.

## API e player

As duas rotas exigem o mesmo JWT de proprietário das outras APIs:

| Rota                                   | Resposta                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| `GET /videos/{uuid}/subtitles`         | JSON com `status`, `tracks` e eventual `message`         |
| `GET /videos/{uuid}/subtitles/{track}` | Conteúdo WebVTT, `Content-Type: text/vtt; charset=utf-8` |

O backend encontra o vídeo na pasta do UUID, verifica existência, exclusão em andamento e retenção antes de ler qualquer legenda. O número da faixa deve existir no manifesto e ter um arquivo VTT válido na mesma pasta. Não aceita chaves arbitrárias para buscar outros objetos. Uma extração sem resultado após 20 minutos é exibida como interrompida; o botão de verificar novamente consulta o estado, sem iniciar processamento adicional.

O front consulta o manifesto e, enquanto houver processamento, verifica novamente a cada cinco segundos. Prefere português, depois a faixa padrão, depois a primeira compatível. O usuário pode trocar o idioma ou desativar a legenda. O Axios envia o JWT para a API e recebe o texto; o player usa uma URL Blob em `<track>`, sem mudar o CORS do vídeo ou ler seus bytes no navegador. A faixa acompanha o relógio nativo e os avanços do vídeo. URLs Blob são liberadas ao trocar/desativar a legenda ou sair da página.

Uma falha na extração ou no carregamento da legenda não encerra a reprodução do vídeo. A validação visual da reprodução e da tela cheia fica com o usuário, sem Chrome headless.

## Retenção e exclusão

A renovação continua vinculada à chave do vídeo no DynamoDB. As legendas usam o mesmo prazo de acesso, sem relógio ou sincronização próprios no banco. Excluir um vídeo, manualmente ou na limpeza agendada, marca a exclusão e remove a pasta inteira daquele UUID. Os derivados são apagados antes do vídeo, para que uma falha permita à limpeza encontrá-lo e repetir a operação. A resposta de exclusão só é bem-sucedida se o S3 confirmar a remoção dos derivados.

O worker verifica disponibilidade antes e depois da publicação e remove suas saídas se o vídeo tiver sido excluído/expirado durante o processamento. A listagem não consulta retenção de arquivos derivados. A limpeza e a API precisam de `s3:ListBucket` para remover a pasta e resolver UUIDs.

## Construção local da Layer

```sh
npm run build:subtitles
```

O script Bash `scripts/build-subtitles.sh` baixa FFmpeg **8.1.3** do site oficial, verifica SHA-256, compila no Docker e copia o ZIP para `infra/.build/subtitles/ffmpeg-layer.zip`. Esse diretório é ignorado pelo Git. O artefato testado tem aproximadamente 5,7 MiB compactados e 14,8 MB descompactados. A Layer inclui `/opt/bin/ffmpeg`, `/opt/bin/ffprobe`, bibliotecas e licença do FFmpeg. O Dockerfile habilita somente os componentes de entrada/saída necessários à extração de texto; não inclui encoders de vídeo.

Execute o build antes de validar/planejar a infraestrutura em um checkout novo, pois o Terraform referencia esse arquivo local. `deploy:back` foi preparado para executar o build antes do Terraform, mas **não foi executado** durante a implementação. Publicar a Layer, as Lambdas, as rotas, o trigger e o frontend continua sendo uma etapa separada, mediante pedido explícito.

## Testes

```sh
python3 -m unittest discover -s subtitles -p 'test_handler.py'
npm test
npm run check
npm run infra:check
```

O worker pode ser exercitado localmente pelo `subtitles/test_local.py`. Ele serve o arquivo indicado por HTTP com Range em loopback e executa o mesmo `extract()` usado pela Lambda. O container pode rodar com rede externa desativada e o MKV montado somente para leitura. As saídas devem ir para `infra/.build/subtitles/test`, sem versionar o vídeo ou suas legendas.

No MKV indicado pelo usuário (2.134.233.843 bytes), o teste encontrou uma faixa SubRip de índice 2, sem idioma declarado. Gerou `2-und.srt` (139.669 bytes) e `2-und.vtt` (122.157 bytes), com 2.116 entradas cada, em cerca de 4 segundos no Docker local. Foram duas requisições e aproximadamente 2,14 GB transferidos pelo HTTP de loopback. Esse resultado valida a extração e os tempos; não é uma medição de desempenho de rede na AWS.
