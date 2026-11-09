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
