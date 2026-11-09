// Tipos comuns da voz da Janete em uso (docs/spec-voz-uso.md, seção 2): o servidor da ElevenLabs, a
// mensageria e as telas (Configuração e onboarding) usam os mesmos. Não importa nada do servidor
// nem da tela.

/** Quando a Janete responde em áudio (configuracao.voz_resposta). */
export const MODOS_VOZ = ["quando_audio", "sempre", "nunca"] as const;
export type ModoVoz = (typeof MODOS_VOZ)[number];
export const MODO_VOZ_PADRAO: ModoVoz = "quando_audio";

/** Forma de um voice_id da ElevenLabs antes de entrar numa URL (o mesmo check do banco). */
export const VOZ_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_NOME_VOZ = 120;

/** Uma voz da conta da ElevenLabs, como a tela mostra. */
export type VozDaConta = {
  id: string;
  nome: string;
  /** Rótulos traduzidos ("Feminina · brasileira"); null sem rótulo. */
  detalhe: string | null;
  /** A ElevenLabs confere a voz em português. */
  portugues: boolean;
  /** Prévia pública (https), a de português quando houver; null sem prévia. */
  previa: string | null;
};

/** A voz escolhida (configuracao.voz_id e voz_nome). */
export type VozEscolhida = { id: string; nome: string };

export type ErroVozes =
  | "chave_invalida"
  | "sem_permissao"
  | "sem_credito"
  | "provedor_fora"
  | "tempo_esgotado"
  | "voz_nao_encontrada";

/** O que a lista de vozes da tela recebe (da Configuração ou do onboarding). */
export type ResultadoListaVozes =
  | { ok: true; vozes: VozDaConta[]; atual: VozEscolhida | null }
  | { ok: false; erro: string; mensagem?: string };
