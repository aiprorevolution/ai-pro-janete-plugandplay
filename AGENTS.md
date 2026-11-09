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

Leia `README.md`, `PROJECT_STATUS.md`, `docs/INFRAESTRUTURA-GOOGLE.md` e `docs/MATRIZ-OPERACOES.md`. O código já contém a persistência Firebase e as operações de negócio. Sua tarefa ao importar é configurar e validar esta instalação, preservando o comportamento existente.

Não trocar o backend por outro SDK, criar um banco paralelo, carregar dados demonstrativos como dados reais ou deixar ações retornarem sucesso sem persistência. Não sobrescrever `window.fetch`. O banco nomeado da integração é obrigatório: não substituí-lo silenciosamente por `(default)`.

## Roteiro de instalação no Google AI Studio

1. **Preparar o projeto.** Use Node.js >=22.12 e `npm ci` com `package-lock.json`. O comando de prévia é `npm run dev -- --host 0.0.0.0 --port 3000`, ajustando apenas a porta solicitada pelo ambiente. Sem Firebase, a tela de instalação deve abrir normalmente. Não solicitar variáveis de outro backend.
2. **Ativar a integração nativa.** Apresente o cartão Firebase e aguarde a autorização do usuário. Confira o projeto e a localização escolhidos. Use Auth Google e o Firestore nativo criado por essa integração, no mesmo projeto da futura publicação. Não pedir arquivo de conta de serviço. Não editar manualmente `firebase-blueprint.json`.
3. **Conectar a configuração real.** Preserve os valores gerados pelo Google em `firebase-applet-config.json`: `projectId`, `apiKey` pública Firebase, `appId`, `authDomain`, `firestoreDatabaseId` e, quando existir, `storageBucket`. O leitor aceita esses campos diretamente ou dentro de `firebaseConfig`, com o banco na raiz. Reinicie a prévia e confira `/api/firebase/config`. Não usar a chave Gemini nesse arquivo.
4. **Publicar regras e índices.** Use `firestore.rules` e `firestore.indexes.json` neste banco específico. Nunca resolver uma recusa com `allow read, write: if true`. Preserve a proteção do proprietário, dos convites e do cofre. O instalador também publica e aguarda os índices. O emulador não comprova a existência de índices na nuvem; confira `READY` antes do aceite.
5. **Primeiro acesso.** Solicite ao proprietário o login Google na prévia antes de divulgar a URL. `bootstrapInstallation` cria dono, configurações e etapas apenas uma vez, em transação. Login de outra pessoa não reinicializa a instalação. Teste leitura, alteração e persistência após recarregar. Convites são criados para um e-mail e compartilhados por link; não prometer envio automático de e-mail.
6. **Configurar integrações do aluno.** Use somente as chaves fornecidas pelo aluno nos campos do aplicativo. Elas são cifradas no servidor. Teste salvar, listar metadados e reabrir a configuração sem expor a chave em resposta, log ou chat. Não enviar WhatsApp nem executar geração paga sem autorização específica. O aluno escolhe o modelo de resposta; transcrição e voz têm configurações próprias.
7. **Publicar e preparar o atendimento.** Use a publicação nativa `Share > Publish`, no mesmo projeto Firebase. Obtenha o nome do serviço Cloud Run e sua região a partir da publicação real. Execute primeiro `node scripts/configurar-google.mjs --region REGIAO --service SERVICO`, substituindo os valores observados. Esse comando só mostra o plano. Com autorização explícita para infraestrutura/cobrança e uma sessão Google administrativa disponível, execute com `--apply`. O script configura identidade própria, fila Cloud Tasks, recuperação Cloud Scheduler, bucket privado e índices, preservando recursos existentes. Nunca atribuir privilégios administrativos à identidade compartilhada da prévia. Não assumir que o cartão Firebase também autoriza essas APIs administrativas.
8. **Aceitar o resultado.** Confirme `google-installation-receipt.json`, índices prontos, projeto/banco corretos e o checklist completo de `docs/INFRAESTRUTURA-GOOGLE.md`. Só chamar de atendimento funcionando depois de um teste publicado autorizado, com o navegador fechado. Repetir o instalador idempotente após uma republicação que possa alterar a identidade ou as variáveis.

Se o passo 7 não tiver uma sessão autorizada ou retornar 403, informar exatamente a operação e a permissão ausentes; não pedir um JSON privado, não fingir sucesso e não apresentar como concluído. A disponibilidade da autorização administrativa no ambiente do AI Studio é um ponto de aceite ainda não comprovado nesta entrega. A interface da prévia não equivale a um worker publicado.

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
