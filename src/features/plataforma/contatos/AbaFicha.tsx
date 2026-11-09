import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";

import { AreaTexto, Botao, Campo } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";

import { nomeDoContato } from "../comum/LinhaConversa";
import { dataLonga, diasEntre, horaCurta, rotuloDia, diaLocal } from "../comum/tempo";
import { usePerfilContato } from "../dados/contatos";
import { useDados } from "../dados/ProvedorDados";
import { conversaDoContato, telefoneLegivel, type Contato } from "../exemplo";
import { EstadoDaAba, PontoEtapa } from "./pecas";
import { textoDaRecusa } from "./recusas";
import type { PropsAba } from "./tipos";
import estilos from "./Ficha.module.css";

const s = estilos as Classes<
  | "fiAba"
  | "fiBloco"
  | "fiBlocoCab"
  | "fiTitulo"
  | "fiLista"
  | "fiVazioValor"
  | "fiNota"
  | "fiObs"
  | "fiForm"
  | "fiFixo"
  | "fiErro"
  | "fiAcoes"
  | "fiEtapa"
>;

// A aba Ficha do perfil (task C4 de docs/spec-contatos.md): os dados do contato, as observações da
// equipe e as datas. O "Editar" (daqui ou do cabeçalho do perfil, pela prop `editando`) troca nome,
// e-mail, empresa e observações por campos; telefone e nome no WhatsApp vêm do WhatsApp e não se
// editam (CamposContato não os aceita). Salvar vai pela camada de dados (acoes.editarContato: no
// banco, um UPDATE que precisa atingir a linha; 0 linhas é recusa).

/** A mesma regra e a mesma frase do Chat (chat/Ficha.tsx), copiadas para não importar de chat/. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ERRO_EMAIL = "Esse e-mail parece incompleto. Confira e salve de novo.";
const ERRO_NOME = "O nome não pode ficar vazio.";

const primeiroNomeDe = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "21 out", no dia de São Paulo. */
function diaCurto(iso: string): string {
  const dia = diaLocal(iso);
  if (!dia) return "";
  const [, mes, d] = dia.split("-");
  return `${Number(d)} ${MESES_CURTOS[Number(mes) - 1]}`;
}

/** "14 de outubro de 2026, 09:12": a data longa sem o dia da semana. */
function dataCompleta(iso: string): string {
  const longa = dataLonga(iso);
  if (!longa) return "";
  return `${longa.slice(longa.indexOf(", ") + 2)}, ${horaCurta(iso)}`;
}

/** "Hoje, 10:16", "Ontem, 18:09" ou "Segunda, 26/10, 11:20". */
function quandoRelativo(iso: string, agora: number): string {
  const dia = rotuloDia(iso, agora);
  return dia ? `${dia}, ${horaCurta(iso)}` : "";
}

interface Rascunho {
  nome: string;
  email: string;
  empresa: string;
  observacoes: string;
}

const rascunhoDe = (c: Contato): Rascunho => ({
  nome: c.nome ?? "",
  email: c.email ?? "",
  empresa: c.empresa ?? "",
  observacoes: c.observacoes ?? "",
});

/** Aparado; vazio vira null (o banco guarda "sem valor" como null). */
const limpo = (v: string): string | null => v.trim() || null;

export function AbaFicha({
  contatoId,
  agora,
  avisar,
  editando,
  aoEditar,
}: PropsAba & { editando: boolean; aoEditar(editando: boolean): void }) {
  const perfil = usePerfilContato(contatoId);
  const estado = perfil.dados;
  const { acoes } = useDados();
  const base = useId();
  const id = (parte: string) => `${base}-${parte}`;

  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroNome, setErroNome] = useState("");
  const [erroEmail, setErroEmail] = useState("");
  const [erroGeral, setErroGeral] = useState("");
  const [salvando, setSalvando] = useState(false);
  const focarEditar = useRef(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);
  const contato = estado?.contatos.find((c) => c.id === contatoId);

  // Ao entrar em edição (pelo botão daqui ou pelo "Editar" do cabeçalho), o rascunho parte do que
  // está salvo e o foco vai para o Nome. Ao sair, o foco volta para o "Editar" (se ele saiu daqui).
  useEffect(() => {
    if (editando) {
      setRascunho(null);
      setErroNome("");
      setErroEmail("");
      setErroGeral("");
      document.getElementById(id("nome"))?.focus();
    } else if (focarEditar.current) {
      focarEditar.current = false;
      document.getElementById(id("editar"))?.focus();
    }
    // `id` só depende do useId, que não muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando]);

  if (!estado) return <EstadoDaAba leitura={perfil} />;
  if (!contato) return null;

  const nome = nomeDoContato(contato);
  const valores = rascunho ?? rascunhoDe(contato);
  const mudar = (campo: keyof Rascunho, valor: string) => {
    setRascunho({ ...valores, [campo]: valor });
    if (campo === "nome" && erroNome) setErroNome("");
    if (campo === "email" && erroEmail) setErroEmail("");
    if (erroGeral) setErroGeral("");
  };

  const sair = () => {
    focarEditar.current = true;
    setRascunho(null);
    setErroNome("");
    setErroEmail("");
    setErroGeral("");
    aoEditar(false);
  };

  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (salvando) return;
    // Quem tinha nome não pode ficar sem (a regra do Chat). Quem nunca teve continua podendo salvar
    // só uma observação, já que o formulário salva tudo de uma vez.
    if (contato.nome?.trim() && !valores.nome.trim()) {
      setErroNome(ERRO_NOME);
      document.getElementById(id("nome"))?.focus();
      return;
    }
    const email = limpo(valores.email);
    if (email && !EMAIL.test(email)) {
      setErroEmail(ERRO_EMAIL);
      document.getElementById(id("email"))?.focus();
      return;
    }
    const campos = {
      nome: limpo(valores.nome),
      email,
      empresa: limpo(valores.empresa),
      observacoes: limpo(valores.observacoes),
    };
    setSalvando(true);
    const r = await acoes.editarContato(contato.id, campos);
    if (!vivo.current) return;
    setSalvando(false);
    if (!r.ok) {
      // O nome vazio (check do banco) volta para o campo; o resto vai para o aviso do formulário.
      if (r.erro === "nome_vazio") {
        setErroNome(ERRO_NOME);
        document.getElementById(id("nome"))?.focus();
        return;
      }
      setErroGeral(textoDaRecusa(r.erro, "salvar"));
      return;
    }
    const novoNome = nomeDoContato({ ...contato, nome: campos.nome });
    sair();
    avisar(`Dados de ${primeiroNomeDe(novoNome)} salvos`);
  };

  // Esc dentro do formulário cancela, sem fechar nada por trás.
  const tecla = (ev: KeyboardEvent<HTMLFormElement>) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    sair();
  };

  /* ---- as datas ---- */

  const conversa = conversaDoContato(estado, contato.id);
  const ultima = conversa?.ultima_mensagem_em ?? null;
  const etapa = estado.etapas.find((e) => e.id === contato.etapa_id);
  const diasNaEtapa = contato.etapa_desde ? diasEntre(contato.etapa_desde, agora) : Number.NaN;
  const desde = contato.etapa_desde
    ? `desde ${diaCurto(contato.etapa_desde)}${
        Number.isFinite(diasNaEtapa) && diasNaEtapa >= 0
          ? ` (${diasNaEtapa === 0 ? "hoje" : diasNaEtapa === 1 ? "1 dia" : `${diasNaEtapa} dias`})`
          : ""
      }`
    : "";

  const valor = (texto: string | null | undefined) =>
    texto?.trim() ? texto.trim() : <span className={s.fiVazioValor}>Não informado</span>;

  const fixo = (rotulo: string, texto: string) => (
    <div className={s.fiFixo}>
      <dt>{rotulo}</dt>
      <dd>
        {valor(texto)} <span className={s.fiNota}>· vem do WhatsApp</span>
      </dd>
    </div>
  );

  return (
    <div className={s.fiAba}>
      {editando ? (
        <form className={s.fiBloco} onSubmit={salvar} onKeyDown={tecla} noValidate aria-labelledby={id("dados")}>
          <div className={s.fiBlocoCab}>
            <h2 id={id("dados")} className={s.fiTitulo}>
              Dados do contato
            </h2>
          </div>
          <div className={s.fiForm}>
            <Campo
              id={id("nome")}
              rotulo="Nome"
              value={valores.nome}
              autoComplete="off"
              erro={erroNome || undefined}
              onChange={(e) => mudar("nome", e.target.value)}
            />
            <dl className={s.fiLista}>
              {fixo("Nome no WhatsApp", contato.nome_whatsapp ?? "")}
              {fixo("Telefone", telefoneLegivel(contato.telefone))}
            </dl>
            <Campo
              id={id("email")}
              rotulo="E-mail"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={valores.email}
              erro={erroEmail || undefined}
              onChange={(e) => mudar("email", e.target.value)}
            />
            <Campo
              id={id("empresa")}
              rotulo="Empresa"
              autoComplete="off"
              value={valores.empresa}
              onChange={(e) => mudar("empresa", e.target.value)}
            />
            <AreaTexto
              id={id("obs")}
              rotulo="Observações da equipe"
              linhas={4}
              placeholder="Anote o que a equipe precisa saber sobre este contato"
              value={valores.observacoes}
              onChange={(e) => mudar("observacoes", e.target.value)}
            />
          </div>
          {erroGeral ? (
            <p className={s.fiErro} role="alert">
              {erroGeral}
            </p>
          ) : null}
          <div className={s.fiAcoes}>
            <Botao type="button" variante="discreto" tamanho="compacto" onClick={sair}>
              Cancelar
            </Botao>
            <Botao type="submit" variante="principal" tamanho="compacto" disabled={salvando} aria-busy={salvando || undefined}>
              {salvando ? "Salvando…" : "Salvar"}
            </Botao>
          </div>
        </form>
      ) : (
        <>
          <section className={s.fiBloco} aria-labelledby={id("dados")}>
            <div className={s.fiBlocoCab}>
              <h2 id={id("dados")} className={s.fiTitulo}>
                Dados do contato
              </h2>
              <Botao
                id={id("editar")}
                variante="contorno"
                tamanho="compacto"
                icone={<Pencil size={16} strokeWidth={2} />}
                aria-label={`Editar os dados de ${nome}`}
                onClick={() => aoEditar(true)}
              >
                Editar
              </Botao>
            </div>
            <dl className={s.fiLista}>
              <div>
                <dt>Nome</dt>
                <dd>{valor(contato.nome)}</dd>
              </div>
              {fixo("Nome no WhatsApp", contato.nome_whatsapp ?? "")}
              {fixo("Telefone", telefoneLegivel(contato.telefone))}
              <div>
                <dt>E-mail</dt>
                <dd>{valor(contato.email)}</dd>
              </div>
              <div>
                <dt>Empresa</dt>
                <dd>{valor(contato.empresa)}</dd>
              </div>
            </dl>
          </section>

          <section className={s.fiBloco} aria-labelledby={id("obs-t")}>
            <h2 id={id("obs-t")} className={s.fiTitulo}>
              Observações da equipe
            </h2>
            {contato.observacoes?.trim() ? (
              <p className={s.fiObs}>{contato.observacoes.trim()}</p>
            ) : (
              <p className={s.fiVazioValor}>Nenhuma observação ainda.</p>
            )}
          </section>
        </>
      )}

      <section className={s.fiBloco} aria-labelledby={id("datas")}>
        <h2 id={id("datas")} className={s.fiTitulo}>
          Datas
        </h2>
        <dl className={s.fiLista}>
          <div>
            <dt>Primeira mensagem</dt>
            <dd>{contato.primeira_mensagem_em ? dataCompleta(contato.primeira_mensagem_em) : valor(null)}</dd>
          </div>
          <div>
            <dt>Última atividade</dt>
            <dd>{ultima ? quandoRelativo(ultima, agora) : valor(null)}</dd>
          </div>
          <div>
            <dt>Na etapa atual</dt>
            <dd className={s.fiEtapa}>
              <PontoEtapa etapa={etapa ?? { nome: "Sem etapa", cor: null }} />
              {desde ? <span>{desde}</span> : null}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
