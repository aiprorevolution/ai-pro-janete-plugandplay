# AI PRO Janete — contexto

## Resultado autorizado
Distribuição independente da AI PRO Janete, de Thiago Caliman, para o aluno importar do GitHub no Google AI Studio, conectar o Firebase próprio e configurar as APIs pelo painel.

## Decisões
- Preservar os sete menus: Chat, Contatos, Kanban, Dashboard, Equipe, Contexto e Configuração.
- Login Google pela integração nativa; e-mail e senha somente quando esse provedor estiver habilitado no Firebase.
- Firestore real com banco nomeado da instalação, Firebase Storage privado e servidor Node no Cloud Run.
- Fila durável no Cloud Tasks e recuperação periódica. Nenhuma dependência de navegador aberto para atendimento publicado.
- Configuração neutra no Git. Sem dados, IDs fixos de projetos, contas ou credenciais do autor.
- Segredos cifrados; chave estável por instalação, sem derivação de token temporário.
- API de IA do aluno; suporte Anthropic, OpenAI, OpenRouter e Gemini.
- Produto identificado somente como AI PRO Janete e Thiago Caliman. Provedores e licenças de dependências mantêm seus nomes técnicos.
- A versão local anterior e o pacote VPS são projetos separados e não são alterados por esta migração.
- O usuário fará a importação final no Google AI Studio. Nenhuma cobrança ou infraestrutura Google é criada nesta etapa de preparação.

## Limite de validação
Build e testes locais não comprovam permissões, OAuth, cobrança, publicação ou operação contínua na conta Google do aluno. O roteiro de aceite deve registrar isso separadamente.
