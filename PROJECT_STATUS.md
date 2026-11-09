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
- Próximo passo: publicar, abrir o diagnóstico e decidir a fila (Cloud Tasks pelo instalador ou processamento no próprio webhook).

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
