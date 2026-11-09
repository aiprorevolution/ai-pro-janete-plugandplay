# AI PRO Janete — infraestrutura Google

Responsável pelo produto: Thiago Caliman.

## O que está implementado

- Dados e transações no Firestore real, usando o banco nomeado da instalação.
- O instalador aplica `firestore.indexes.json` ao banco nomeado e aguarda todos os índices exigidos chegarem a `READY`. Preserva índices já existentes, reconhece o campo `__name__` acrescentado pelo Google e não remove índices alheios.
- Autenticação Firebase; ações do painel usam a sessão validada. O atendimento publicado usa uma conta de serviço própria, sem depender de uma sessão aberta.
- Webhook autenticado do provedor, persistência e deduplicação antes da resposta. Reentrega repetida pode recriar uma tarefa, mas não duplica o evento lógico.
- Cloud Tasks envia uma chamada OIDC para `/api/public/cron/mensageria`. O servidor verifica assinatura, validade, audiência e e-mail da conta de serviço. Cabeçalhos `X-CloudTasks-*` sozinhos não autorizam.
- O worker executa uma passada de até 45 segundos e persiste a próxima tarefa para o vencimento mais próximo. A resposta 2xx acontece após a persistência; falha retorna 503 para nova tentativa.
- Um Cloud Scheduler a cada cinco minutos recupera trabalho persistido caso a primeira tentativa de enfileirar tenha falhado. Não existe dependência de aba aberta, intervalo do navegador ou processo solto após responder HTTP.
- O worker sincroniza a URL pública do webhook quando uma conexão foi configurada antes da publicação. Provedores sem API para cadastrar webhook conservam a configuração manual exigida por eles.
- Reservas transacionais evitam disputa entre tarefas. Confirmação de envio perdida é tratada como incerta; sem confirmação posterior, requer revisão humana em vez de reenvio automático que possa duplicar a mensagem.
- Áudio, imagem e documento são binários no bucket Google privado. O Firestore guarda referências e metadados; não recebe base64 de arquivos.
- Downloads usam URL GCS V4 válida por até uma hora, assinada por IAM. Não existe chave privada JSON nem link público permanente.
- Anthropic, OpenAI, OpenRouter e Gemini estão integrados ao motor de resposta. Escuta e voz mantêm configuração própria; trocar o modelo de resposta não troca silenciosamente o transcritor.

## Fluxo de instalação pelo agente do AI Studio

1. Mostrar o cartão nativo Firebase e usar o projeto escolhido pelo aluno. Preservar `firebase-applet-config.json`, em especial `firestoreDatabaseId`. Não criar outro banco para contornar erros.
2. Publicar regras e concluir o primeiro login Google do proprietário antes de compartilhar o app com terceiros.
3. Verificar a configuração, salvar uma chave de teste do próprio aluno e confirmar a persistência após reiniciar a prévia.
4. Usar a publicação nativa do AI Studio (`Share > Publish`). Obter o nome do serviço Cloud Run e sua região no mesmo projeto Firebase.
5. Apresentar o plano com `node scripts/configurar-google.mjs --region REGIAO --service SERVICO`. Sem `--apply`, esse comando só lê a configuração local e imprime os recursos previstos; não chama a nuvem.
6. Com autorização do dono para infraestrutura/cobrança, verificar se o ambiente realmente dispõe de ADC autorizado para administrar o projeto. Essa identidade **não é garantida pela integração Firebase do AI Studio**. Só executar o mesmo comando com `--apply` quando ela existir. Não inventar um cartão ou comando de autorização que o agente não oferece; não pedir JSON de conta de serviço.
7. O instalador grava `google-installation-receipt.json` somente quando conclui, incluindo a contagem de índices em `READY`. Identificar edição e região do banco no recibo; nenhum dado de atendimento ou segredo entra nesse arquivo.
8. Abrir a URL publicada e executar o checklist abaixo. Ao republicar, repetir o instalador idempotente para garantir que variáveis e identidade foram preservadas.

`REGIAO` e `SERVICO` são preenchidos pelo agente com os valores observados na publicação, não pelo aluno a partir de exemplos. O arquivo de configuração da cópia contém identificadores públicos próprios e não deve voltar ao repositório distribuído aos alunos.

## Recursos e permissões

O instalador calcula um sufixo a partir do banco nomeado, para separar cópias no mesmo projeto:

| Recurso | Configuração |
|---|---|
| Conta de serviço da instalação | `janete-SUFIXO`, nunca uma identidade compartilhada da prévia |
| Firestore | `roles/datastore.user` limitado por condição IAM ao banco nomeado |
| Bucket | Nome específico da instalação, acesso público impedido e acesso uniforme obrigatório |
| Acesso aos objetos | Leitura/gravação pela identidade do servidor no bucket da instalação |
| URLs temporárias | A conta assina por IAM; nenhuma chave privada exportada |
| Fila Cloud Tasks | Uma tarefa simultânea, até uma por segundo, repetição com espera progressiva |
| Cloud Run | Identidade própria, prazo de 120 s, mínimo zero e máximo duas instâncias |
| Recuperação | Cloud Scheduler autenticado a cada cinco minutos |

O instalador preserva imagem, variáveis preexistentes e políticas IAM por união de permissões, com `etag`; não substitui políticas por uma lista vazia. Recusa modificar bucket preexistente sem a etiqueta da instalação.

O ambiente Cloud Run recebe `JANETE_FIREBASE_CONFIG` com uma lista explícita dos campos públicos necessários: projeto, chave pública Firebase, app, domínio de autenticação, banco nomeado, bucket e endereço publicado. Assim, o artefato `.output` funciona sem carregar o arquivo local `firebase-applet-config.json`. Chaves privadas e propriedades arbitrárias do arquivo não são copiadas. O arquivo gerado do aluno permanece local e deve estar no `.gitignore`, assim como o recibo.

Índices usam a API Native e a densidade compatível com a edição observada: `SPARSE_ALL` para Standard e `SPARSE_ANY` para Enterprise. A criação é assíncrona; se o prazo de espera acabar, a instalação permanece pendente e uma nova execução retoma a conferência. `NEEDS_REPAIR` ou falta de permissão interrompem a instalação sem recibo de conclusão. O instalador não modifica `fieldOverrides` e recusa um arquivo que passe a exigi-los, até receber suporte explícito.

## Segredos e limite de confiança

A chave mestra é aleatória, criada uma única vez em transação em `cofre_config/master`. Os registros são cifrados com AES-256-GCM, IV novo e dado associado à identidade do registro. Trocar login, renovar token ou publicar uma revisão não altera essa chave.

Na prévia, quando a identidade do servidor não está disponível, a operação conserva a autorização Firebase do proprietário. Regras permitem o acesso ao cofre somente ao proprietário; operadores não o acessam. As APIs de dados não expõem a coleção, e as respostas do painel não devolvem as chaves de IA coladas.

O proprietário controla o próprio projeto Firebase e pode ler seus dados pelo console; esta proteção não pretende ocultar os segredos do dono da instalação. Na publicação, a identidade do servidor acessa a mesma chave estável. `JANETE_MASTER_SECRET` existe para testes isolados ou montagem de segredo no servidor: não alterar seu valor numa instalação já utilizada sem recifrar os registros. Não usá-la como passo manual para o aluno.

## Prévia e publicação

A prévia permite instalar, entrar e configurar o app. Atendimento automático, acesso ao bucket e URLs assinadas dependem da identidade própria publicada. A interface deve apresentar esse estado; a ausência de permissão não pode gerar um resultado fictício de sucesso.

O cartão Firebase não promete instalar sozinho Cloud Tasks, Scheduler e Storage. O instalador precisa de credenciais padrão do Google (ADC) com permissões para configurar esses recursos. Não foi comprovado que o agente do AI Studio disponibiliza essa autorização administrativa. Se houver 403 ou ausência de ADC apropriado, interromper e informar o recurso/permissão faltante. Isso é uma pendência real de instalação; a existência de um “fluxo nativo” alternativo não deve ser presumida. Não pedir credencial JSON, não conceder IAM à identidade compartilhada da prévia e não declarar plug and play validado até a instalação limpa passar.

Publicação e Storage podem exigir cobrança habilitada. O instalador não vincula uma conta de cobrança, não amplia orçamento e não envia uma mensagem de teste. O Scheduler pode processar tarefas já existentes depois de instalado; usar projeto limpo e conexões de teste para o aceite inicial.

## Checklist de aceite na nuvem

- [ ] Projeto, banco nomeado e proprietário pertencem ao aluno; nenhum identificador do autor foi herdado.
- [ ] Login, chaves e configurações persistem após reiniciar e publicar.
- [ ] Regras negam leitura a visitante e impedem operador de acessar o cofre ou administrar membros.
- [ ] Identidade do Cloud Run acessa o banco e o bucket sem sessão do proprietário aberta.
- [ ] A publicação carrega a configuração pública pelo ambiente mesmo sem `firebase-applet-config.json`; todos os índices exigidos estão `READY` no banco nomeado correto.
- [ ] Requisição sem OIDC, com assinatura inválida, audiência diferente ou outra conta de serviço é recusada pelo worker.
- [ ] Webhook inválido é recusado; evento repetido não duplica contato/mensagem.
- [ ] Com o navegador fechado, mensagem de teste recebida chega ao chat e gera a tarefa esperada.
- [ ] Interrupção do worker retoma reservas; intervenção humana cancela a resposta automática pendente.
- [ ] Confirmação de envio perdida não produz reenvio automático duplicado.
- [ ] Áudio/imagem/documento abre com URL temporária, sem conteúdo binário no Firestore.
- [ ] Modelo de resposta e transcrição funcionam com as próprias chaves da instalação.
- [ ] Somente com autorização específica, resposta ao número pessoal de teste completa envio/recebimento e atualização do status.
- [ ] Consumo, latência, limites e custos são medidos no projeto real antes de distribuir amplamente.

## Validação desta implementação

O código do motor, autenticação da tarefa, criptografia, adapter Storage e instalador têm testes locais com provedores simulados somente dentro dos testes. Esses testes não provam IAM, cobrança, disponibilidade de ferramentas do agente nem publicação no Google. Nenhum provisionamento externo ou envio real foi executado ao preparar este código. A validação na conta do aluno continua obrigatória.

Referências oficiais: [Firebase nativo no AI Studio](https://firebase.google.com/docs/ai-assistance/ai-studio-integration), [Cloud Tasks com Cloud Run](https://cloud.google.com/run/docs/triggering/using-tasks), [IAM por banco Firestore](https://firebase.google.com/docs/firestore/manage-databases), [definição de índices por edição](https://firebase.google.com/docs/reference/firestore/indexes), [API dos índices](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.indexes), [política IAM da fila](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues/getIamPolicy), [Storage JSON API](https://cloud.google.com/storage/docs/json_api), [Cloud Scheduler](https://cloud.google.com/scheduler/docs/http-target-auth).
