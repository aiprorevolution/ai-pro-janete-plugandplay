# AI PRO Janete

Atendimento com IA e WhatsApp — **Thiago Caliman**.

Esta é a versão independente para importar no **Google AI Studio**, conectar o **Firebase da própria conta** e publicar. Não contém contatos, banco, usuários, chaves ou configurações do autor. O código usa Firebase real; a migração de banco já está implementada.

**Estado:** versão candidata a teste de instalação. Os testes locais e seus limites estão em [VALIDACAO.md](docs/VALIDACAO.md). A importação e a publicação em uma conta Google nova ainda precisam do aceite descrito no guia.

## Começar no Google AI Studio

1. **GitHub:** crie uma conta em [github.com/signup](https://github.com/signup), abra [github.com/thiagocaliman/ai-pro-janete-plugandplay](https://github.com/thiagocaliman/ai-pro-janete-plugandplay) e clique em **Fork › Create fork**. O fork serve só para importar; as atualizações vêm direto deste repositório.
2. No **Build** do Google AI Studio, conecte o seu GitHub e importe **o seu fork** pelo **Import from GitHub**. Não cole o link do repositório no chat: o agente tenta recriar o app em vez de importá-lo.
3. Na tela **"Prepare sua AI PRO Janete"**, clique em **Copiar instrução**, cole no chat do AI Studio e **aceite o cartão do Firebase**. O agente segue a seção 1 do [AGENTS.md](AGENTS.md): conecta o Firebase da sua cópia, publica as regras e reinicia a prévia.
4. Clique em **Entrar com Google**. O primeiro login verificado cria o proprietário dessa instalação; faça isso antes de compartilhar o endereço.
5. Clique em **Publish** no AI Studio e escolha o endereço (`nome.ai.studio`). O atendimento com o navegador fechado só funciona no app publicado: a prévia é protegida e o WhatsApp não a alcança.
6. Abra o **endereço publicado**, entre com Google e, **lá**, informe sua chave de IA e conecte o WhatsApp. A Janete registra o webhook no provedor e, nesse primeiro acesso, prepara sozinha o banco (índices) para o atendimento.

Se, depois de entrar, aparecer *"A instalação do Firebase ainda precisa ser concluída pelo agente do AI Studio"*, peça no chat: *"Publique as regras do Firestore desta cópia, seguindo o AGENTS.md, e reinicie a prévia."* Depois recarregue a página e entre de novo.

No app publicado, a Janete usa a identidade que o próprio Publish cria: recebe o webhook, cria os índices que faltam e responde na hora, sem fila e sem instalador (em validação). O instalador (`scripts/configurar-google.mjs`) continua opcional para quem quiser fila durável, recuperação agendada e bucket de mídia, e exige uma sessão Google com permissão administrativa. Não há etapa de criar um arquivo de credenciais JSON.

## Atualizar uma cópia (sem perder dados)

Quando houver uma versão nova, escreva no chat do AI Studio da sua cópia:

> Atualize esta cópia pelo GitHub, seguindo o AGENTS.md.

O agente copia o repositório inteiro de uma vez (seção 3 do [AGENTS.md](AGENTS.md)), mantém a conexão com o seu Firebase, publica as regras e reinicia. Dono, atendimentos e chaves ficam no Firestore e não são tocados.

- **Não use** o botão **Sync to GitHub / Force push** do AI Studio: ele envia a sua cópia para o GitHub, e não o contrário.
- Se algo der errado, use **Restore** no checkpoint anterior à atualização e peça de novo.

## O que está incluído

- Dashboard, chat, contatos, kanban, contexto, equipe e configurações.
- Contas Google; administrador e atendentes; convites por link compartilhado e e-mail autorizado.
- Firestore com banco nomeado por instalação, regras e índices.
- Respostas com Gemini, OpenAI, Anthropic ou OpenRouter; áudio e voz têm suas próprias configurações.
- Integrações WhatsApp existentes, recebimento, fila durável, transferência para humano e controle de mensagens duplicadas.
- Arquivos em bucket Google privado; somente referências e metadados no Firestore.
- Instalador de recursos Google com prévia das mudanças, execução explícita e retomada.

## Desenvolvimento e verificação

Requer Node.js 22.12 ou mais recente. Esta versão foi verificada com Node.js 24 e npm 11. O arquivo `package-lock.json` fixa as dependências; use npm nesta cópia.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 3000
```

Sem a configuração Firebase, a tela inicial orienta a integração. Nenhum banco fictício é criado. No ambiente do AI Studio, o agente usa o host e a porta exigidos por ele, normalmente `0.0.0.0:3000`.

```sh
npm run typecheck
npm test -- --maxWorkers=4
npm run test:google
npm run build
npm start
```

`npm test` bloqueia a rede externa e não envia WhatsApp. Os testes do Firestore requerem o emulador oficial iniciado localmente e a variável `FIRESTORE_EMULATOR_HOST`; use `npm run test:firestore`. Os testes recusam um host externo e usam projetos com prefixo `demo-`.

## Documentação

- [AGENTS.md](AGENTS.md): roteiro obrigatório para o agente de instalação.
- [Infraestrutura Google](docs/INFRAESTRUTURA-GOOGLE.md): publicação, tarefas, arquivos, permissões e checklist real.
- [Matriz de operações](docs/MATRIZ-OPERACOES.md): funções implementadas e limites.
- [Estado do projeto](PROJECT_STATUS.md): resultado da entrega e próxima ação.

Publicação, armazenamento, IA e provedor WhatsApp podem consumir saldo nas contas do aluno. O instalador não vincula cobrança automaticamente. Antes de distribuir amplamente, valide o fluxo publicado, as regras e o consumo em uma instalação limpa.
