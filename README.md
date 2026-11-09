# AI PRO Janete

Atendimento com IA e WhatsApp — **Thiago Caliman**.

Esta é a versão independente para importar no **Google AI Studio**, conectar o **Firebase da própria conta** e publicar. Não contém contatos, banco, usuários, chaves ou configurações do autor. O código usa Firebase real; a migração de banco já está implementada.

**Estado:** versão candidata a teste de instalação. Os testes locais e seus limites estão em [VALIDACAO.md](docs/VALIDACAO.md). A importação e a publicação em uma conta Google nova ainda precisam do aceite descrito no guia.

## Começar no Google AI Studio

1. Importe este repositório em um aplicativo novo do AI Studio.
2. Cole esta instrução no agente:

> Leia o AGENTS.md e instale esta AI PRO Janete usando a integração nativa Firebase na minha conta. Preserve a implementação existente. Conduza a configuração, o primeiro login e a publicação seguindo o roteiro, sem pedir credencial JSON manual. Mostre claramente qualquer etapa que não puder concluir e não declare o atendimento pronto só porque a prévia abriu.

3. Autorize o cartão Firebase e entre com sua conta Google. O primeiro login verificado cria o proprietário dessa instalação; faça isso antes de compartilhar o endereço.
4. Na configuração do aplicativo, informe suas próprias chaves de IA e do provedor WhatsApp.
5. Siga a publicação e a instalação do atendimento em segundo plano conduzidas pelo agente.

A integração nativa prepara login e Firestore. **Receber webhooks, guardar mídias e atender com o navegador fechado também exige publicação e os recursos de servidor descritos no guia.** O instalador acompanha o código, mas precisa de uma sessão Google com permissão administrativa para aplicar esses recursos. A disponibilidade dessa autorização no ambiente do AI Studio ainda precisa ser conferida no teste de importação. Não há etapa de criar um arquivo de credenciais JSON.

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
