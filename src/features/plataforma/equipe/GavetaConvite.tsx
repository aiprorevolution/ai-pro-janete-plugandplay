import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Info, Mail } from "lucide-react";

import { Botao, Campo } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";

import { FecharGaveta, Gaveta } from "../comum/Gaveta";
import type { PapelMembro } from "../exemplo/tipos";

import estilos from "./GavetaConvite.module.css";

// A gaveta "Convidar pessoa" da Equipe (o `.gv-*` do Equipe B): só e-mail e papel, porque o nome vem
// quando a pessoa entra com Google. Quem decide se o convite foi é a tela: `aoEnviar` devolve o erro (que
// aparece no campo, com o foco de volta nele) ou `null`, e aí a tela fecha a gaveta. Sem `<form>`: o
// Enter no campo envia pelo próprio onKeyDown, como no protótipo.

const s = estilos as Classes<
  | "cvCab"
  | "cvCabTexto"
  | "cvTitulo"
  | "cvApoio"
  | "cvCorpo"
  | "cvGrupo"
  | "cvRotulo"
  | "cvPapeis"
  | "cvPapel"
  | "cvPapelNome"
  | "cvPapelTexto"
  | "cvNota"
  | "cvNotaIcone"
  | "cvPe"
  | "cvEnviar"
  | "cvCancelar"
  | "cvSr"
>;

interface Props {
  aberta: boolean;
  aoFechar: () => void;
  /**
   * Devolve o erro do convite, ou `null` se ele foi (e então quem fecha a gaveta é a tela). Pode
   * responder depois (o banco): enquanto isso, o botão mostra "Criando" e não manda de novo.
   */
  aoEnviar: (email: string, papel: PapelMembro) => string | null | Promise<string | null>;
}

const PAPEIS: { papel: PapelMembro; nome: string; texto: string }[] = [
  {
    papel: "atendente",
    nome: "Atendente",
    texto: "Atende as conversas que a Janete passa para a equipe, responde e move os leads. Não vê a Configuração.",
  },
  {
    papel: "admin",
    nome: "Admin",
    texto: "Atende como todo mundo e também convida e desativa pessoas, troca papéis e mexe na Configuração.",
  },
];

export function GavetaConvite({ aberta, aoFechar, aoEnviar }: Props) {
  return (
    <Gaveta aberta={aberta} aoFechar={aoFechar} rotulo="Convidar pessoa">
      {/* O conteúdo só existe com a gaveta aberta: ao reabrir, o e-mail, o papel e o erro começam do zero. */}
      {aberta ? <ConteudoConvite aoFechar={aoFechar} aoEnviar={aoEnviar} /> : null}
    </Gaveta>
  );
}

function ConteudoConvite({ aoFechar, aoEnviar }: Omit<Props, "aberta">) {
  const base = useId();
  const idEmail = `${base}-email`;
  const idTitulo = `${base}-titulo`;
  const idApoio = `${base}-apoio`;
  const idPapel = `${base}-papel`;

  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<PapelMembro>("atendente");
  const [erro, setErro] = useState<string | null>(null);
  // Conta as recusas: cada uma entra como nó novo na região de alerta, e o mesmo erro de novo é lido de novo.
  const [recusas, setRecusas] = useState(0);
  const [enviando, setCriando] = useState(false);
  const enviandoRef = useRef(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const recusar = (resposta: string) => {
    setErro(resposta);
    setRecusas((n) => n + 1);
    document.getElementById(idEmail)?.focus();
  };

  const enviar = () => {
    if (enviandoRef.current) return;
    const resposta = aoEnviar(email, papel);
    if (resposta === null) return;
    if (typeof resposta === "string") {
      recusar(resposta);
      return;
    }
    enviandoRef.current = true;
    setCriando(true);
    void resposta
      .catch(() => "Não deu para enviar o convite agora. Confira a internet e tente de novo.")
      .then((r) => {
        enviandoRef.current = false;
        if (!montado.current) return;
        setCriando(false);
        if (r !== null) recusar(r);
      });
  };

  const tecla = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    enviar();
  };

  return (
    <>
      <div className={s.cvCab}>
        <div className={s.cvCabTexto}>
          <h2 id={idTitulo} className={s.cvTitulo}>
            Convidar pessoa
          </h2>
          <p id={idApoio} className={s.cvApoio}>
            Crie o convite, copie o link e compartilhe com a pessoa. Ela entra com a conta Google desse e-mail.
          </p>
        </div>
        <FecharGaveta aoFechar={aoFechar} />
      </div>

      <div className={s.cvCorpo}>
        <Campo
          id={idEmail}
          rotulo="E-mail"
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          placeholder="nome@empresa.com.br"
          data-autofocus=""
          prefixo={<Mail size={18} strokeWidth={1.75} />}
          value={email}
          erro={erro ?? undefined}
          onChange={(ev) => {
            setEmail(ev.target.value);
            setErro(null);
          }}
          onKeyDown={tecla}
        />
        {/* Com o Enter, o foco já está no campo e nada reanuncia o erro (a mensagem do Campo não é região
            viva): o leitor de tela ouve por aqui. A região existe desde a abertura, vazia. */}
        <p className={s.cvSr} role="alert">
          {erro ? <span key={recusas}>{erro}</span> : null}
        </p>

        <div className={s.cvGrupo}>
          <span id={idPapel} className={s.cvRotulo}>
            Papel
          </span>
          <div className={s.cvPapeis} role="radiogroup" aria-labelledby={idPapel}>
            {PAPEIS.map((p) => (
              <label key={p.papel} className={s.cvPapel}>
                <input
                  type="radio"
                  name={`${base}-papel`}
                  value={p.papel}
                  checked={papel === p.papel}
                  onChange={() => setPapel(p.papel)}
                />
                <b className={s.cvPapelNome}>{p.nome}</b>
                <span className={s.cvPapelTexto}>{p.texto}</span>
              </label>
            ))}
          </div>
        </div>

        <p className={s.cvNota}>
          <Info className={s.cvNotaIcone} size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>
            Até aceitar com Google, a pessoa aparece aqui como “Convite criado”, com Renovar, Copiar link e Cancelar. Ela só recebe
            conversas depois de entrar.
          </span>
        </p>
      </div>

      <div className={s.cvPe}>
        <Botao type="button" variante="principal" className={s.cvEnviar} carregando={enviando} onClick={enviar}>
          {enviando ? "Criando" : "Criar convite"}
        </Botao>
        <Botao type="button" variante="discreto" className={s.cvCancelar} onClick={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </>
  );
}
