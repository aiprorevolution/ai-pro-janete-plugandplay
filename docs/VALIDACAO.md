# Validação da AI PRO Janete

Data: 9 de novembro de 2026. Responsável pelo produto: Thiago Caliman.

## Resultado local

| Verificação | Resultado observado |
|---|---|
| Instalação limpa `npm ci` | Concluída; dependências fixadas no package-lock |
| `npm run typecheck` | Aprovado |
| `npm test -- --maxWorkers=8` | 3.827 aprovados, zero falhas; os 17 casos de emulador ficam separados |
| `npm run test:firestore` | 17 aprovados, zero falhas no emulador oficial local |
| `npm run test:google` | 11 aprovados; nenhuma infraestrutura externa criada pelos testes |
| `npm run build` | Compilação Node/Nitro concluída |
| Servidor da compilação | Inicializou somente em loopback para a verificação local |
| `/healthz` | HTTP 200; aplicação AI PRO Janete |
| `/api/firebase/config` sem instalação | HTTP 200 e `null`; não usa configuração do autor |
| `/entrar` | HTTP 200; tela de instalação e marca confirmadas no navegador |
| API Firebase sem login | HTTP 401 |
| Consumidor de tarefas sem autorização | HTTP 401 |
| Busca pelas marcas antigas | Nenhuma referência encontrada nos arquivos distribuídos |
| Arquivos pessoais e padrões de credenciais | Nenhum arquivo de banco, backup, configuração particular ou chave pessoal identificado no snapshot |

Total: **3.855 verificações aprovadas** entre suíte geral, emulador e instalador. A auditoria automatizada de padrões não substitui controle de segredos na manutenção futura.

## O que o emulador efetivamente exercitou

- Bootstrap transacional e imutabilidade do proprietário.
- Convite válido, vencido, usuário não verificado e tentativas de ganhar papel de administrador.
- Negação de acesso a visitante e ao cofre por atendente.
- Consultas reais de chat, equipe e histórico; ordenação, combinações OR, contagem e paginação.
- Deduplicação concorrente de recebimento, reserva de rodada, fila de saída e recibo de entrega.
- Handlers reais de salvar ritmo e chave de IA: administrador grava e recupera; atendente é recusado. A validação do provedor usa um dublê de teste e não consome API paga.
- Exclusão de contato com os registros associados, usando a identidade do proprietário.

O emulador usou apenas projetos `demo-` no próprio PC. Não foram usados dados, contatos ou credenciais de uma instalação real. Firebase Auth/Google Sign-In, chamadas dos provedores e IAM externo não foram testados por login ou chamadas reais nesta etapa.

## Correções reveladas pela validação

- Leitura de documentos dentro de transações usa `batchGet` compatível com a API REST e o emulador.
- Consultas incompatíveis com as combinações permitidas no Firestore foram divididas, ordenadas e deduplicadas sem ocultar paginação.
- Escritas administrativas internas têm autorização própria e preservam o ator; a API do navegador não recebe esse privilégio.
- A prévia usa o token do proprietário e não tenta assumir a identidade compartilhada do ambiente.
- Exclusão de contato sem mídia funciona na prévia, mesmo sem identidade para o bucket. Contato com mídia é preservado quando não há acesso para limpar arquivos.
- Convites correspondem ao e-mail Google verificado, com validade, consumo atômico e papel guardado no convite.
- O instalador preserva políticas IAM, confere métodos das APIs e aguarda a construção dos índices.

## O que falta comprovar no Google

Esta entrega é uma **candidata a teste de instalação**, e não uma declaração de funcionamento universal para todos os alunos.

1. Importação limpa pelo AI Studio e geração da configuração do Firebase da própria conta.
2. Login Google, persistência, regras e construção dos 110 índices no banco nomeado real.
3. Disponibilidade de autorização administrativa para o instalador. O cartão Firebase não comprova permissão para criar fila, bucket, Scheduler ou alterar a identidade do Cloud Run.
4. Publicação e acesso da identidade própria ao banco, ao bucket e à fila.
5. Webhook externo, recebimento e processamento com a aba fechada.
6. IA, áudio, imagem e envio WhatsApp com as chaves do aluno, mediante autorização para o teste real.
7. Consumo e desempenho com volume real; relatórios usam leituras proporcionais ao histórico e têm limites documentados.

Veja os critérios de aceite em [INFRAESTRUTURA-GOOGLE.md](INFRAESTRUTURA-GOOGLE.md). Nenhuma cobrança foi vinculada, nenhum recurso de nuvem foi provisionado e nenhum WhatsApp foi enviado nesta preparação.
