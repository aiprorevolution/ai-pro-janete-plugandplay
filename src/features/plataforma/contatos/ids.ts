// Os ids de foco da tela de Contatos, num módulo à parte: a TelaContatos foca, e a tabela e o perfil
// põem os ids nos elementos. Ficando aqui, nenhum dos três importa o outro de volta (sem importação
// circular).

/** O id do h1 do perfil: o foco vai para ele quando o perfil abre. */
export function idTituloPerfil(contatoId: string): string {
  return `contato-perfil-${contatoId}`;
}

/** O id do botão do nome do contato na tabela: o foco volta para ele quando o perfil fecha. */
export function idLinhaContato(contatoId: string): string {
  return `contato-linha-${contatoId}`;
}
