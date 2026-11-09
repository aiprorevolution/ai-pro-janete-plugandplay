# AI PRO Janete — estado

Versão 0.1.0 candidata a teste de importação, 9 de novembro de 2026.

## Feito
- Cópia independente criada, sem banco, .env ou chaves da instalação anterior.
- Identidade e componentes renomeados para AI PRO Janete.
- Dependências Google adicionadas somente nesta pasta.
- Autenticação, persistência, transações e permissões migradas para Firebase real.
- Operações de atendimento, fila Cloud Tasks, recuperação e bucket Google privado implementados.
- Gemini, OpenAI, Anthropic e OpenRouter nas respostas; transcrição/voz mantêm configurações próprias.
- Convites por conta Google verificada e link compartilhado pelo administrador.
- Chaves e configurações testadas pelos handlers reais no emulador Firestore.
- Identidade AI PRO também nos símbolos internos; autoria Thiago Caliman.
- Instalação padronizada em npm, com package-lock e sem ferramentas portáteis no Git.
- Primeiro acesso da compilação observado no navegador: instrução de integração e identificação AI PRO Janete / Thiago Caliman.
- Repositório privado criado: https://github.com/thiagocaliman/ai-pro-janete-plugandplay .

## Ajustes antes do teste de importação (9 de novembro de 2026)
Lições de outro app AI PRO validado do zero no AI Studio, aplicadas aqui:
- Frase da tela inicial curta: conecta o Firebase, publica as regras e reinicia; a publicação vem depois, a pedido.
- AGENTS.md em quatro roteiros: primeiro acesso (com as ferramentas do AI Studio que funcionaram), depois do primeiro acesso (publicação e instalador), atualização da cópia (tudo ou nada, preservando os arquivos particulares) e problemas comuns.
- `DeployRules` obrigatório: num banco novo, as regras padrão recusam tudo; em outro app, o agente pulou esse passo.
- Prévia escuta em `0.0.0.0` por padrão (o AI Studio também acrescenta `--host` e `--port`).
- README: importação por fork (o Import from GitHub só lista repositórios da conta conectada; colar o link no chat faz o agente recriar o app) e seção de atualização.
- O repositório está privado: o dono importa direto; para alunos, ele precisa ficar público.

## Teste de importação no AI Studio (9 de novembro de 2026)
- Importação, tela inicial, cartão Firebase, provisionamento e `DeployRules` funcionaram; as regras publicadas no banco conferem com `firestore.rules`.
- O primeiro login com Google era recusado. Causa 1 (diagnóstico): o proxy da prévia troca o corpo das respostas 403/502/503/504 por HTML; corrigido com a mesma proteção do outro app AI PRO (status original em `error_status`, log da recusa e mensagem do servidor na tela).
- Prevenção: o primeiro acesso gravava 13 documentos num commit, e as regras somavam ~36 consultas (o Firestore de produção recusa acima de 20). Agora o dono é decidido numa transação pequena e o resto vem em gravações pequenas, com teste que conta as consultas por commit.
- Causa raiz, confirmada pelo log com a operação: o Firestore real recusa `:beginTransaction` pela API REST com o token do usuário (PERMISSION_DENIED; a conta chegava verificada e com o e-mail correto). O emulador aceita. Corrigido: sem identidade própria do servidor, as transações são otimistas, como nos SDKs do Firebase no navegador (leitura com versão e commit com precondição `updateTime` ou `exists:false`, refeito se alguém mudou no meio). Com `JANETE_RUNTIME_SERVICE_ACCOUNT` (serviço publicado), segue a transação de servidor.
- **Validado no AI Studio (9/11/2026):** depois da atualização, o primeiro login com Google criou o dono e abriu o assistente de configuração.
- Observação: no AI Studio o Node é 22; alguns pacotes do Firebase avisam que pedem Node 24 (só aviso no `npm ci`; o app roda).
- Sem ninguém logado e sem o instalador, o servidor tenta a identidade do próprio serviço publicado; o endereço público pode vir do `APP_URL` do AI Studio. `/api/firebase/diagnostico` diz se isso funciona no app publicado.
- **Diagnóstico no app publicado (9/11/2026):** identidade própria = sim; banco com identidade própria = ok; endereço público = o do serviço; fila = ausente. Mensagens da Z-API passaram a ser recebidas e gravadas.
- Sem fila, o webhook processa na hora (`acordarMotor(..., { naHora: true })` → `processarNaHora`): roda o ciclo, espera o agrupamento de mensagens vencer e responde, até 45 s por pedido. Com o instalador (Cloud Tasks), segue a fila.
- Sem ninguém logado, o banco é acessado pela identidade do serviço com transação de servidor (isolamento completo contra resposta duplicada); com login, modo otimista.
- O motor precisa de 110 índices compostos. Sem o instalador, o app publicado os cria com a própria identidade (`POST /api/firebase/diagnostico/indices`); o diagnóstico mostra índices e estado do motor.
- Índices automáticos: no login do dono no app publicado (até 25 s, sem impedir o login) e antes do atendimento no webhook (até 20 s), uma vez por processo; na prévia não faz nada.
- Envio manual pelo chat ficava "na_fila": o `pedirEnvio` rodava o ciclo com a identidade do usuário, e `pegar_envios` só aceita o sistema (`requireSystem`); depois o toque dependia da fila. Agora, conferido o membro, ciclo e toque rodam como sistema, e o toque processa na hora sem fila.
- Toque do motor sem fila (portado do app original, que usava o banco para chamar o worker): no app publicado, o webhook e o envio pelo chat não rodam mais o atendimento dentro do próprio pedido. Eles chamam a rota do worker do próprio app com a chave do motor (derivada do segredo da instalação, cabeçalho `x-janete-motor`) e esperam no máximo 1,5 s. A rodada do worker (até 45 s) pede o toque seguinte enquanto houver item pronto nos próximos 10 min ou vencido há menos de 10 min; enquanto uma rodada está de pé na instância, não sai outro toque. Item vencido que ninguém pega espera 1, 2, 4, 8 s em vez de consultar o banco a cada segundo. Com o instalador (Cloud Tasks), nada muda. **Não comprovado no AI Studio:** se o app publicado alcança o próprio endereço e se a rodada continua depois que quem tocou para de esperar.
- Webhook de quem conecta o WhatsApp na prévia e depois publica (visto no banco de uma instalação nova, 9/11/2026: conexão Z-API "conectada" e `webhook_public_origin` vazio): o endereço publicado só era registrado no gateway dentro da rodada do worker, que só rodava ao chegar mensagem. Agora o login de um membro no app publicado pede o toque do motor; a rodada registra o webhook. Na prévia não faz nada. **Não comprovado no AI Studio.**
- **Comprovado no AI Studio (9/11/2026, instalação nova, sem instalador):** o login no app publicado rodou o worker e registrou o webhook da Z-API no endereço publicado; uma mensagem de texto foi respondida pela IA em ~22 s (8 s são do agrupamento), com uma rodada e uma resposta; os avisos da Z-API foram processados em 0,04 a 0,4 s cada; o envio manual pelo chat saiu em ~9 s. O serviço publicado roda com a conta padrão do Compute (papel de editor do projeto), com no máximo 1 instância.
- O banco que o AI Studio cria é da edição Enterprise, que executa consultas sem índice composto: o atendimento acima rodou com zero índices. Nela o app não cria nem confere índices (a listagem com `pageSize` era recusada com 400). Na edição Standard, segue criando os que faltam.
- Mídia sem o instalador: o `storageBucket` da configuração do AI Studio aponta para um bucket que não existe, e um áudio recebido falhou 3 vezes ao ser guardado. Agora o app publicado cria o próprio bucket privado (`janete-midias-<projeto>`, acesso público bloqueado, arquivos apagados pelo Google depois de 30 dias) e confere que ele é deste projeto. Sem a permissão de assinatura do Google, a mídia é servida pelo próprio app (`/api/public/midia/…`, link de até 1 h assinado com chave derivada do segredo da instalação), para o chat e para o gateway. O áudio é transcrito mesmo quando guardar o arquivo falha. **Não comprovado no AI Studio**; num projeto sem faturamento, criar o bucket pode ser recusado (o áudio ainda é transcrito; imagem e anexo não).
- Próximo passo: atualizar, republicar, entrar no app publicado e testar áudio recebido, imagem recebida, imagem enviada pelo chat e áudio de resposta.

## Validação
- 3.827 testes gerais aprovados, sem rede externa.
- 17 testes aprovados no emulador oficial Firestore.
- 11 testes do instalador aprovados sem provisionamento.
- Typecheck e build aprovados; servidor compilado responde e recusa API/tarefa sem autenticação.
- Auditoria de marcas e arquivos particulares sem ocorrências no snapshot.
- Evidência detalhada: `docs/VALIDACAO.md`; limites: `docs/MATRIZ-OPERACOES.md`.

## Próxima ação
Importar o repositório em um app novo do Google AI Studio e seguir `AGENTS.md`. O usuário fará esse teste. Não reaproveitar configuração de outro projeto e não pedir credencial JSON manual.

## Teste externo
Importação limpa, integração Firebase, publicação e teste controlado de WhatsApp ainda não foram executados nesta versão. Em especial, é necessário comprovar a autorização administrativa para instalar Cloud Tasks, Scheduler e Storage; a integração nativa Firebase sozinha não garante essa permissão. Não declarar plug and play homologado antes de concluir esse aceite.
