# AI PRO Janete — Thiago Caliman

Projeto independente para importação no Google AI Studio e integração nativa com Firebase.

## Regras
- Preserve os sete menus e as regras de atendimento existentes.
- Firebase real: sem banco simulado, credenciais do autor ou sobrescrita de `window.fetch`.
- O aluno autoriza a integração nativa; nunca pedir arquivo JSON de conta de serviço.
- Projeto e banco nomeado vêm da configuração gerada pelo AI Studio, nunca de valores fixos.
- Segredos somente no servidor; identidade própria do serviço publicado para trabalho sem usuário conectado.
- Atendimento em segundo plano deve usar tarefas duráveis, deduplicação e retomada.
- Não enviar WhatsApp real nem chamar APIs pagas durante testes automatizados.
- Marcas do produto: AI PRO Janete e Thiago Caliman. Nomes técnicos de provedores e licenças de dependências permanecem corretos.
- Não alterar a instalação local ou a preparação VPS. Não copiar dados, contas ou chaves delas.
- Nunca commitar `.env`, credenciais, dados pessoais, node_modules ou saídas de build.
- Não reverter mudanças de outros agentes. Coordenar arquivos compartilhados.

## Leia antes de instalar

Leia `README.md`, `PROJECT_STATUS.md`, `docs/INFRAESTRUTURA-GOOGLE.md` e `docs/MATRIZ-OPERACOES.md`. O código já contém a persistência Firebase e as operações de negócio. Sua tarefa ao importar é configurar esta instalação pelo roteiro da seção 1, preservando o comportamento existente.

Não trocar o backend por outro SDK, criar um banco paralelo, carregar dados demonstrativos como dados reais ou deixar ações retornarem sucesso sem persistência. Não sobrescrever `window.fetch`. O banco nomeado da integração é obrigatório: não substituí-lo silenciosamente por `(default)`.

## 1. Primeiro acesso (siga na ordem, sem pular)

**Gatilho:** o aluno cola a frase da tela inicial, *"Conecte o Firebase desta cópia e publique as regras do Firestore, seguindo o AGENTS.md."*, ou pede para conectar o Firebase.

Esta sequência de ferramentas foi validada do zero, com uma conta Google nova, em outro app AI PRO no AI Studio.

1. **Prepare o projeto.** Use Node.js >=22.12 e `npm ci` com o `package-lock.json`. A prévia roda `npm run dev` em `0.0.0.0:3000` (o AI Studio acrescenta `--host` e `--port`). Sem Firebase, a tela de instalação abre normalmente. Não solicite variáveis de outro backend.
2. **Leia a skill de Firebase:** `/skills/system_skills/firebase-integration-rpc/SKILL.md` com `view_file`.
3. **Peça a autorização:** chame `show_aistudio_ui` com `ui_type: "firebase_setup"` e **pare o turno** até o aceite (`user_confirmed_in_ui: true`). Não peça arquivo de conta de serviço.
4. **Provisione o Firebase da cópia:** `rpc_action` com `service_name: "fax"`, `method_name: "ProvisionFirebase"` e `arguments: { "platform": "web", "project_id": "<ID do projeto escolhido no cartão>" }`.
   - Passe o `project_id` explicitamente. Em outro app, a chamada sem ele usou um projeto antigo da conta, embora o cartão mostrasse outro.
   - Preserve os valores gerados em `firebase-applet-config.json`: `projectId`, `apiKey` pública, `appId`, `authDomain`, `firestoreDatabaseId` e, quando existir, `storageBucket`. O leitor aceita esses campos diretamente ou dentro de `firebaseConfig`, com o banco na raiz. Não use a chave Gemini nesse arquivo e não edite `firebase-blueprint.json` à mão.
   - Confira se o `projectId` gravado é o do cartão. Se não for, pare e corrija antes do passo 5.
5. **Publique as regras (obrigatório, nunca pule):** valide `firestore.rules` com `lint_applet` e chame `rpc_action` com `service_name: "fax"`, `method_name: "DeployRules"` e `arguments: {}`.
   - O banco novo nasce com as regras padrão, que **recusam tudo**. Sem este passo, o primeiro login falha com *"A instalação do Firebase ainda precisa ser concluída pelo agente do AI Studio."*
   - Em outro app, num teste com conta nova, este passo foi pulado depois do aceite do cartão. Faça-o sempre, mesmo que o `ProvisionFirebase` tenha terminado sem erro.
   - Nunca resolva uma recusa com `allow read, write: if true`. Preserve a proteção do proprietário, dos convites e do cofre.
6. **Reinicie:** chame `restart_dev_server` e confira `/api/firebase/config`.
7. **Confira que o `DeployRules` do passo 5 terminou com sucesso** e só então responda ao aluno numa frase: *"Pronto! Na prévia, clique em **Entrar com Google**. O primeiro login verificado vira o dono desta cópia."*

Não faça mais nada nesse primeiro acesso. Em especial: não publique o app, não rode o instalador da seção 2, não grave documentos no Firestore e não peça e-mail. No primeiro login, `bootstrapInstallation` decide o dono numa transação pequena (instalação e membro administrador) e, em seguida, cria a configuração e as etapas que faltarem, uma gravação por vez. O Firestore de produção recusa um commit cujas regras façam mais de 20 consultas; o emulador não aplica esse limite. O login de outra pessoa não reinicializa a instalação.

**Índices:** `firestore.indexes.json` é publicado pelo instalador da seção 2, não pelo `DeployRules`. Se uma tela mostrar *"O banco ainda precisa concluir os índices"*, informe o aluno qual tela foi e não desative a consulta.

## 2. Depois do primeiro acesso (só quando o aluno pedir)

1. **Integrações do aluno.** Use somente as chaves fornecidas pelo aluno nos campos do aplicativo. Elas são cifradas no servidor. Teste salvar, listar metadados e reabrir a configuração sem expor a chave em resposta, log ou chat. Não envie WhatsApp nem execute geração paga sem autorização específica. O aluno escolhe o modelo de resposta; transcrição e voz têm configurações próprias. Convites são criados para um e-mail e compartilhados por link; não prometa envio automático de e-mail.
2. **Publicar e preparar o atendimento.** Use a publicação nativa (`Share > Publish`), no mesmo projeto Firebase. Obtenha o nome do serviço Cloud Run e a região a partir da publicação real. Execute primeiro `node scripts/configurar-google.mjs --region REGIAO --service SERVICO`, com os valores observados. Esse comando só mostra o plano.
   - Depois de publicar, abra `https://<endereço publicado>/api/firebase/diagnostico`. Ele responde só sim/não: se o serviço publicado tem identidade própria, se ela alcança o banco, o endereço público (do instalador ou do `APP_URL` do AI Studio) e se a fila existe. Sem o instalador, o servidor já tenta a identidade do próprio serviço quando não há ninguém logado.
   - Índices sem o instalador: o app publicado cria sozinho os que faltam no login do dono e antes do atendimento. Para forçar: `POST https://<endereço publicado>/api/firebase/diagnostico/indices` cria, com a identidade do serviço, os índices de `firestore.indexes.json` que faltam (idempotente; o Google leva minutos para construí-los). O `GET …/diagnostico` mostra a situação dos índices e o estado do motor (última execução, últimos eventos e rodadas, só status e códigos).
   - Sem a fila do Cloud Tasks, o webhook grava a mensagem, responde ao gateway na hora e pede um toque: o app publicado chama a própria rota do worker (`/api/public/cron/mensageria`, com a chave do motor), que roda o atendimento por até 45 s e pede o toque seguinte enquanto houver trabalho perto. Não precisa do instalador. Na prévia, sem endereço publicado, o processamento é dentro do próprio pedido.
   - Execute com `--apply` somente com autorização explícita do aluno para infraestrutura e cobrança **e** com uma sessão Google administrativa disponível. O script configura identidade própria, fila Cloud Tasks, recuperação Cloud Scheduler, bucket privado e índices, preservando recursos existentes.
   - Nunca atribua privilégios administrativos à identidade compartilhada da prévia. Não assuma que o cartão Firebase também autoriza essas APIs.
   - Se não houver sessão autorizada ou a resposta for 403, informe exatamente a operação e a permissão ausentes. Não peça um JSON privado, não finja sucesso e não apresente como concluído. **A disponibilidade dessa autorização no ambiente do AI Studio ainda não foi comprovada.**
3. **Aceitar o resultado.** Confirme `google-installation-receipt.json`, índices `READY`, projeto e banco corretos e o checklist de `docs/INFRAESTRUTURA-GOOGLE.md`. Só chame de atendimento funcionando depois de um teste publicado autorizado, com o navegador fechado. A prévia não equivale a um worker publicado. Repita o instalador (idempotente) depois de uma republicação que possa alterar a identidade ou as variáveis.

## 3. Atualização de uma cópia existente

**Gatilho:** o aluno pede, por exemplo: *"Atualize esta cópia pelo GitHub, seguindo o AGENTS.md."*

O código novo vem do GitHub; os dados (dono, atendimentos, chaves) ficam no Firestore e não são tocados. Os arquivos particulares da cópia (`firebase-applet-config.json`, `firebase-blueprint.json`, `google-installation-receipt.json` e o `metadata.json` do AI Studio) não estão no repositório e precisam sobreviver.

**A atualização é tudo ou nada.** Copie o repositório inteiro com os comandos abaixo, na raiz da cópia. Não escolha arquivos e não copie "só os que mudaram": uma cópia pela metade (um arquivo novo que procura uma função num arquivo antigo) derruba o servidor com `does not provide an export named …`.

```bash
rm -rf /tmp/janete-backup && mkdir -p /tmp/janete-backup && for f in firebase-applet-config.json firebase-blueprint.json google-installation-receipt.json metadata.json; do [ -f "$f" ] && cp "$f" /tmp/janete-backup/; done
rm -rf /tmp/janete-main && git clone --depth 1 https://github.com/thiagocaliman/ai-pro-janete-plugandplay /tmp/janete-main && rm -rf /tmp/janete-main/.git
cp -R /tmp/janete-main/. .
for f in /tmp/janete-backup/*; do [ -f "$f" ] && cp "$f" .; done
```

Se o `git` não existir no ambiente, troque a segunda linha por:
`rm -rf /tmp/janete-main && mkdir -p /tmp/janete-main && curl -fsSL https://codeload.github.com/thiagocaliman/ai-pro-janete-plugandplay/tar.gz/refs/heads/main | tar -xz --strip-components=1 -C /tmp/janete-main`

**Confira antes de seguir** (as duas verificações são obrigatórias):

```bash
grep -c '"projectId"' firebase-applet-config.json
diff -rq /tmp/janete-main . -x node_modules -x .output -x .tanstack -x .nitro -x dist | grep -v "^Only in \.:"
```

- A primeira deve mostrar `1` ou mais: a cópia continua conectada ao próprio Firebase.
- A segunda **não deve mostrar nada**: nenhum arquivo do GitHub ficou diferente na cópia. Arquivos que só existem na cópia são normais e não aparecem.

Depois: `npm ci`, `lint_applet` e o build; publique as regras (`DeployRules`) e reinicie (`restart_dev_server`). Responda ao aluno numa frase: *"Cópia atualizada! Seus dados e chaves continuam os mesmos."*

**Nunca** envie nada ao GitHub (nada de Sync nem Force push), não provisione outro banco, não altere dados do Firestore e não redefina o dono. Se um comando falhar (por exemplo, o clone pedir usuário e senha ou responder *not found*, sinal de repositório privado), **pare e mostre o erro exato**: não recrie código de memória nem copie arquivos um a um.

## 4. Problemas comuns

| O aluno vê | Causa provável | Ação do agente |
|---|---|---|
| *"A instalação do Firebase ainda precisa ser concluída pelo agente do AI Studio"* logo no primeiro login | Regras não publicadas neste banco: o passo 5 da seção 1 foi pulado | `lint_applet` + `DeployRules` e `restart_dev_server`; peça para recarregar e entrar de novo com Google |
| Tela "Prepare sua AI PRO Janete" depois de aceitar o cartão | `ProvisionFirebase` não gravou a configuração ou a prévia não reiniciou | Confira `firebase-applet-config.json` e chame `restart_dev_server` |
| *"O banco ainda precisa concluir os índices"* | Índice composto ainda não existe neste banco | Informe a tela afetada; os índices são publicados pelo instalador da seção 2 |
| *"Conclua a publicação e a identidade do servidor para usar esta função"* | Função que depende do serviço publicado (webhook, fila, mídia) | Explique que isso faz parte da seção 2 e ainda não foi comprovado no AI Studio |
| *"O limite de uso do Firebase foi atingido"* | Cota diária do Firestore esgotada | Informe que a cota volta no dia seguinte e que o consumo aparece em Firestore › Uso |
| Cartão mostra um projeto que não é desta cópia | Seleção anterior lembrada pelo AI Studio | Escolha o projeto certo no cartão antes do aceite e passe o `project_id` dele |

## Organização técnica

- `src/integrations/firebase`: configuração, identidade, Firestore REST, regras de autorização do adaptador e operações transacionais.
- `src/features/plataforma`: sete áreas, componentes e funções de servidor.
- `src/features/plataforma/equipe`: convites e papéis.
- `src/features/mensageria`: provedores, mídia, IA, filas, retomada e transferência para humano.
- `src/routes/api/public`: webhook autenticado e consumidor OIDC de tarefas.
- `scripts/configurar-google.mjs`: instalação idempotente dos recursos Google; sem `--apply`, não acessa a nuvem.
- `src/server.ts`: servidor Node, `/healthz`, API Firebase e TanStack.

`firebaseAdmin` é um cliente interno do servidor, não uma credencial fornecida pelo aluno. A prévia pode usar a identidade Firebase do proprietário para operações autorizadas; o serviço publicado usa sua própria identidade. `rpc-test-store.ts` e dublês de provedores são exclusivos dos testes.

## Comandos de validação

```sh
npm run typecheck
npm test -- --maxWorkers=4
npm run test:google
npm run build
```

Com emulador oficial iniciado, execute `npm run test:firestore` e defina `FIRESTORE_EMULATOR_HOST` para o endereço loopback. Não apontar testes ao banco de produção. `npm test` bloqueia rede externa por padrão. Nenhum teste deve disparar WhatsApp real.

## Continuidade e critério de pronto

Atualize `PROJECT_STATUS.md` com o que foi executado de verdade, as limitações e o próximo passo. Identifique separadamente teste local, importação, publicação e entrega real de mensagem. A versão distribuída deve permanecer sem `firebase-applet-config.json`, recibos da instalação, credenciais, dados ou identificadores fixos de um aluno. Arquivos gerados pelo Google ficam somente na cópia particular dele.
