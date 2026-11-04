# Instruções do projeto

## Estilo de código

- Não use factories. Prefira funções diretas, com dependências explícitas nos argumentos quando necessário.
- Não crie funções como `createService(dependencies)` que retornam objetos de métodos ou outras funções para compor os serviços.

## Commit e push

- Nunca faça commit ou push sem o usuário pedir explicitamente a ação correspondente.
- Deixe as alterações locais sem commit para o usuário revisar e testar antes.
- Pedidos para implementar, corrigir, testar ou concluir uma tarefa não autorizam commit ou push. Uma autorização para commit não autoriza push.
- Não crie commits nem envie alterações por scripts, ferramentas, plugins ou agentes auxiliares sem esse pedido explícito.

## Deploy e alterações em serviços externos

- Nunca faça deploy automaticamente. Só faça deploy quando o usuário pedir explicitamente essa ação na conversa atual.
- Pedidos para implementar, corrigir, testar, configurar ou adicionar funcionalidades autorizam somente alterações locais e validações locais. Não implicam autorização para publicar.
- Não execute `npm run deploy`, `deploy:back`, `deploy:front`, `terraform apply`, sincronizações para S3, invalidações do CloudFront ou comandos equivalentes sem esse pedido explícito.
- Não altere recursos reais da AWS, segredos no Parameter Store ou outros serviços externos sem autorização explícita para a alteração específica. Uma autorização para configurar um segredo ou recurso não autoriza deploy da aplicação.
- Ao concluir, informe as alterações locais e as validações realizadas. Deixe o deploy pendente, sem solicitar autorização para publicar por iniciativa própria.
- Esta regra vale também para scripts, ferramentas, plugins e agentes auxiliares.
