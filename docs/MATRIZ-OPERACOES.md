# Matriz de operações — AI PRO Janete

Implementação independente de Thiago Caliman. Esta matriz descreve o domínio da versão Google e distingue o que foi executado localmente do que ainda depende da instalação real do aluno.

## Persistência e confiança

`rpc.server.ts` é um despachante de operações de negócio, não um executor SQL. Cada operação usa documentos, consultas e transações reais do Firestore por `Store`. A interface conserva os nomes usados pela aplicação para evitar reescrever todos os componentes. Operação desconhecida falha com `operacao_nao_suportada`; não existe retorno genérico de sucesso.

- Identidade: Firebase Auth verificado; documento `membros/{uid}` com `ativo=true` e papel real `admin`/`atendente`. Nunca confiar em `role` enviado no pedido.
- Operações de entrada, fila e ferramentas da IA exigem contexto de serviço autenticado. O campo `system` não pode vir do corpo de uma requisição do navegador.
- Transações leem antes do commit, enxergam suas próprias alterações e consolidam uma escrita por documento. Conflitos são repetidos pelo transporte Firestore.
- Índices únicos são documentos SHA-256 em `indices_unicos`; a leitura e a criação desses documentos ocorrem na mesma transação dos registros. `sequencias` preserva os IDs numéricos exigidos pelos contratos de eventos/contexto.
- O único armazenamento em memória está no auxiliar de testes `rpc-test-store.ts`. Nenhum caminho de execução do produto o importa.

## Operações utilizadas pela aplicação

| Operações / uso | Implementação Google e efeitos | Validação local |
|---|---|---|
| `eh_membro`, `eh_admin`, `membro_atual` — sessão, handlers e equipe | Leitura de `membros/{uid}`; exige conta verificada e membro ativo | Identidade não verificada, papel falso e ausência de acesso rejeitados |
| `registrar_evento_webhook` — entrada dos provedores | Registro atômico do evento e índice por gateway/conexão/ID; retry retorna o mesmo ID | Duplicação e mesmo ID em conexões distintas |
| `registrar_entrada` — WhatsApp recebido | Resolve identificadores/contato/conversa; deduplica mensagem; atualiza não lidas, primeira mensagem, prévia e debounce | Concorrência em teste isolado e Firestore local real; edição/deleção sem duplicar |
| `registrar_saida_celular` — eco/ação no telefone | Distingue eco de envio conhecido; ação humana cancela automação; confirmação posterior reconcilia somente o eco comprovado | Reconciliação do eco sem deixar a conversa em modo humano |
| `atualizar_status` — recibos | Procura ID externo/gateway na conexão; estados de entrega não retrocedem | Recibo lida seguido de entregue; ciclo REST real |
| `contato_por_ids`, `conversa_do_contato`, `ids_normalizados` — resolução interna | Identificadores normalizados; conflito entre contatos é recusado; conversa única por contato | Telefone já cadastrado manualmente reutilizado |
| `pegar_rodadas` — consumidor durável | Reserva transacional; lease de 5 minutos; recupera rodada abandonada; respeita onboarding, conexão, janela oficial e espera de mídia | Reserva simultânea produz uma rodada; lease e retomada |
| `falhar_rodada` — erro do provedor | Libera entradas; retry transitório de 30 segundos até três tentativas; depois passa para humano | Três falhas e entrega para equipe |
| `concluir_rodada` — fim da IA | Grava respostas uma vez; preserva cancelamento humano; até 12 respostas, ordem e intervalo | Conclusão repetida não duplica a fila |
| `pegar_envios`, `concluir_envio`, `falhar_envio` — saída | Uma mensagem em envio por conversa, ordem e horário; lease de 2 minutos; confirmação atômica com ID externo | Ciclo REST real e idempotência isolada |
| `reenviar_mensagem` — ação humana | Permite somente falha conhecida de mensagem humana da tela; incerteza de aceitação pelo gateway impede reenvio automático | Timeout vencido não dispara de novo |
| `pegar_midias`, `concluir_midia`, `desistir_midia` — anexos | Reserva com lease de 2 minutos e até três tentativas; caminho vinculado à conversa/mensagem; estado copiada/falhou | Código portado; transferência de arquivo real depende de Storage e gateway |
| `pegar_eventos_pendentes`, `falhar_evento` — retomada de webhook | Reserva de evento não processado após 30 segundos; lease de 2 minutos; até cinco falhas | Deduplicação coberta; recuperação de eventos por tarefa depende do deploy |
| `motor_pendencias` — painel e agendamento | Datas de debounce, envio, mídia, evento e leases; separa vencido/futuro; não fica reagendando conversa sem configuração | Sem onboarding/conexão não gira; lease futuro preservado |
| `assumir_conversa`, `devolver_para_janete`, `marcar_lida` — chat | Mudança de responsável e modo, eventos e cancelamento/reserva atômicos; devolução rearma somente entrada pendente | Intervenção enquanto rodada está em andamento |
| `janete_atualizar_contato`, `janete_mover_etapa`, `janete_passar_para_humano` — ferramentas da IA | Rodada ativa obrigatória; campos permitidos; trava de movimento humano; histórico e passagem para equipe | Alteração humana impede movimento posterior da IA |
| `contexto_salvar`, `contexto_restaurar` — contexto/onboarding | Versões imutáveis numeradas; conflitos por campo; alterações independentes se combinam; restauração gera nova versão | Merge, conflito, restauração e rollback sem registro parcial |
| `concluir_onboarding`, `marcar_visto` — primeira configuração/tour | Data idempotente de conclusão e marcação no membro atual | Mesmo transporte transacional; cenário de onboarding no teste de fila |
| `reordenar_etapas` — configuração do funil | Admin; conjunto completo sem repetição; separa abertas e encerramento | Validações no domínio; interação visual depende de teste da aplicação |
| `trocar_papel_membro`, `desativar_membro`, `reativar_membro` — equipe | Admin; impede alterar a própria conta/último admin; desativação libera atendimentos para fila e registra auditoria | Liberação de conversas e rejeição de acesso após desativar |
| `contatos_lista`, `contatos_contadores`, `buscar_quadro` — contatos/chat/kanban | Busca normalizada, filtros, ordenação, paginação e recortes pelo membro real | Contadores e recorte comigo |
| `custo_das_conversas` — conversa | Apenas admin; soma das chamadas vinculadas, até 200 conversas por consulta | Caminho protegido pelo teste de papéis; somas históricas no dashboard |
| `dashboard_agora` — situação atual | Fila humana, não lidas, responsável, rodadas, kanban, envelhecimento e últimos contatos | Dados reais inseridos pelo domínio |
| `dashboard_periodo` — indicadores e séries | Conversas distintas por dia, primeira resposta, latência por rodada, autonomia, passagens e custo somente para admin | Datas, latência, preenchimento de dias e REST real |
| `dashboard_funil` — coorte e etapas | Reconstitui estágio histórico; alcance do funil, perdas, silêncio, tempo, movimentos e atribuição de mensagens/custos na data do evento | Sem duplicar custo entre etapas; custos ocultos do atendente |
| `dashboard_custo` — gastos | Totais por tipo/modelo, resposta por conversa e valor fora da coorte; somente admin | Separação de custo de resposta e onboarding |
| `dashboard_problemas` — incidentes | Agrupa falhas consecutivas; sucesso encerra grupo; reconexão encerra indisponibilidade | Agrupamento e duração da conexão |
| `mensagem_da_conversa`, `rodada_rodando` — validações internas | Verifica pertencimento e estado atual | Usadas pelas mesmas operações transacionais |
| `preparar_copia` — preparação interna | Só informa pronta após bootstrap; visitante anônimo não vira dono | Bootstrap e regras têm testes próprios do adaptador |
| `motor_endereco`, `motor_confere` — compatibilidade interna | Somente serviço; HTTPS válido e comparação constante de segredo quando aplicável | Não usados para criar credencial manual |
| `manutencao_janete` — manutenção | Remove eventos já processados com mais de 30 dias, até 100 por execução, junto com índice de deduplicação | Implementada; execução periódica depende da instalação |
| `texto_busca`, `texto_normalizado`, `tipo_de_mensagem`, `dashboard_etapa_em`, `dashboard_custo_por_etapa`, `dashboard` | Auxiliares de compatibilidade explícitos; nenhum SQL executado | Tipos verificados; auxiliares principais exercitados por operações maiores |

`acordar_motor` do acionador antigo não é implementado como uma chamada ao banco. O motor atual enfileira Cloud Tasks no servidor; uma chamada antiga falha explicitamente com `usar_fila_cloud_tasks`.

## Efeitos que antes eram automáticos no banco

`applyMutation` em `rpc-mutations.ts` substitui esses efeitos na entrada única de escrita do adaptador:

| Escrita | Efeito obrigatório |
|---|---|
| Contato novo/etapa alterada | Etapa de entrada, validação, `etapa_desde` e histórico com ator |
| Mensagem inserida/alterada | Prévia, não lidas, lote, atribuição humana, cancelamento da IA e encaminhamento de falha |
| Conexão ativa/inativa | Uma conexão ativa; eventos de mudança e limpeza dos segredos ao desativar |
| Etapa arquivada | Impede arquivar etapa usada ou a última aberta |
| Chaves, convites e identificadores | Índices de unicidade conforme o contrato |
| Contato excluído | Marca exclusão, bloqueia nova entrada, elimina conversa/histórico em lotes; chamadas de IA ficam anônimas para preservar total de custos |
| Qualquer coleção alterada | O transporte atualiza `mudancas/{colecao}` para invalidação do cliente |

O navegador tem campos explícitos para editar contato, editar etapa como admin e inserir mensagem humana. Escritas arbitrárias em membros, segredos, eventos e filas são recusadas. Handlers de servidor precisam verificar o papel antes de usar contexto de serviço. O cliente interno confere novamente admin para mutações de configuração, chaves, conexões e auditoria; isso não muda o ator de `eh_admin` e não dá a mesma permissão à API remota.

Convites foram separados em `features/plataforma/equipe/equipe-store.server.ts`: admin cria/renova/cancela; a conta Google com e-mail verificado aceita em transação, com validade de sete dias e papel guardado no convite. Bootstrap pertence a `bootstrap.server.ts`, com regras e testes próprios.

## Limites assumidos explicitamente

- Consultas de relatórios/contatos são paginadas em blocos de 500, com teto de 10.000 documentos por conjunto consultado. Acima disso retornam `consulta_muito_ampla`; não exibem total parcial como completo. O teto não representa meta de desempenho: relatórios históricos ainda fazem leituras proporcionais aos registros e ao histórico de cada contato. Para alto volume, materializar agregações antes de distribuição ampla.
- Paginação atual usa offset, que pode gerar cobrança pelas leituras puladas no Firestore. Não foi feita medição de custo nesta etapa Google.
- Há limites menores para coleções pequenas (100 etapas, 500 membros), entradas de uma rodada (200) e cancelamento. Uma operação que ultrapasse o limite falha claramente, sem efetuar commit parcial.
- Uma transação de domínio aceita no máximo 450 documentos alterados; o transporte acrescenta as revisões de coleções. Exclusão de conversa grande usa lotes de 100 e pode ser retomada se interrompida.
- Reservas e cálculo de próximo trabalho consultam lotes limitados. A fila Cloud Tasks e o heartbeat devem continuar drenando os lotes; o horário retornado não é um relatório de todas as mensagens da instalação.
- Envio cujo gateway pode ter aceitado, mas não respondeu, fica pendente de confirmação/recibo ou resolução humana. Reenviar automaticamente poderia duplicar o WhatsApp.
- O emulador valida documentos/transações/regras; não substitui validação de índices e permissões IAM no Google real. Publicar os índices antes do teste de importação.

## Evidência executada nesta cópia

Em 9 de novembro de 2026:

- `node node_modules/vitest/vitest.mjs run src/integrations/firebase/rpc-domain.test.ts`: **27 testes aprovados**.
- Com `FIRESTORE_EMULATOR_HOST=127.0.0.1:55386`, `node node_modules/vitest/vitest.mjs run src/integrations/firebase/rpc-emulator.test.ts`: **3 testes aprovados** usando o transporte REST real e transações do emulador oficial, projeto isolado `demo-janete-rpc`.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: **aprovado** na verificação desta etapa.
- O teste REST de configuração executou os handlers reais de ritmo e chave de IA: admin salva, recarrega e decifra; atendente é recusado; query remota continua sem acesso de escrita. Somente a validação externa do modelo foi injetada como resposta fictícia dentro do teste.
- Nenhum WhatsApp real, API paga ou projeto de nuvem foi acionado por estes testes.

Ainda exigem validação na instalação publicada: importação limpa com configuração nativa, IAM/índices, tarefa autenticada em Cloud Tasks, webhook externo, entrega/recebimento de mídia, provedores de IA e experiência visual completa. A passagem dos testes locais não autoriza chamar a distribuição de 100% validada.
