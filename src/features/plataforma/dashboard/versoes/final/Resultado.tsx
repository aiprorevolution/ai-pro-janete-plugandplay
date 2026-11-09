import { ArrowUp } from "lucide-react";
import { memo, type CSSProperties, type ReactNode, type Ref } from "react";

import { Botao, Esqueleto } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";

import { MOTIVO_CURTO } from "../../../comum/LinhaConversa";
import { contagem, dias, dinheiro, numero, porcentagem, usePainelDashboard, type MotivoHumano } from "../../dados";
import { rotuloMotivo } from "./Cartoes";
import { Variacao } from "./comum";
import { BarrasDia } from "./Graficos";
import estilos from "./Resultado.module.css";

// O resultado do período (spec 9), vindo da versão D: os 5 números grandes num cartão só, com o
// encerramento embaixo; "Janete × equipe" e, para o admin, o custo detalhado (por tipo, por modelo e a
// frase honesta das chamadas sem preço). Tudo lido de usePainelDashboard(); as barras divididas
// repartem o espaço pelo flex-grow dos números crus (nenhuma soma nem fração aqui).

const s = estilos as Classes<
  | "resultado"
  | "resultadoCab"
  | "titulo"
  | "tituloSep"
  | "frase"
  | "custoDia"
  | "modelo"
  | "bloco"
  | "blocoTitulo"
  | "grandes"
  | "grande"
  | "grandeUnidade"
  | "encerramento"
  | "resultadoBlocos"
  | "resultadoColuna"
  | "linhas"
  | "linha"
  | "trilho"
  | "legenda"
  | "apoio"
  | "pares"
  | "tabela"
  | "resultadoPe"
  | "honesta"
  | "vazioLinha"
>;

/** O pedaço de uma barra dividida: ocupa o espaço na proporção do número cru (flex-grow). */
const parte = (valor: number) => ({ flexGrow: Math.max(0, valor) }) as CSSProperties;

/**
 * Os ids vêm crus da fundação ("anthropic", "claude-haiku-5-5"). O provedor ganha o nome de exibição;
 * o modelo fica como vem, na fonte monoespaçada (inventar maiúscula criava nomes que não existem).
 */
const PROVEDORES: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", google: "Google", groq: "Groq", mistral: "Mistral", elevenlabs: "ElevenLabs" };
const legivel = (id: string) => (id ? id.charAt(0).toUpperCase() + id.slice(1) : id);
const nomeProvedor = (id: string) => PROVEDORES[id.toLowerCase()] ?? legivel(id);

/** O esqueleto de um bloco de baixo enquanto o período carrega (a mesma forma: a altura não pula). */
function BlocoOsso({ titulo, linhas }: { titulo: string; linhas: number }) {
  return (
    <div className={s.bloco} aria-hidden="true">
      <h3 className={s.blocoTitulo}>{titulo}</h3>
      <Esqueleto forma="texto" linhas={linhas} />
    </div>
  );
}

const ORIGENS: readonly { id: "janete" | "humano_tela" | "humano_celular"; nome: string; tom: "janete" | "equipe" | "celular" }[] = [
  { id: "janete", nome: "a Janete", tom: "janete" },
  { id: "humano_tela", nome: "a equipe pela plataforma", tom: "equipe" },
  { id: "humano_celular", nome: "o celular da empresa", tom: "celular" },
];

/**
 * A unidade menor e mais leve que o número ("7,6" grande e "dias" pequeno; "US$" pequeno antes de
 * "2,21"): só a forma muda, o texto continua "US$ 2,21" e "7,6 dias".
 */
function partesDoValor(valor: string): { prefixo?: string; principal: string; sufixo?: string } {
  if (valor.startsWith("US$ ")) return { prefixo: "US$", principal: valor.slice(4) };
  const m = /^([\d.,]+) ([a-zà-ú]+)$/i.exec(valor);
  if (m) return { principal: m[1]!, sufixo: m[2]! };
  return { principal: valor };
}

function Grande({ rotulo, valor, apoio, carregando }: { rotulo: string; valor: string; apoio: string; carregando: boolean }) {
  const { prefixo, principal, sufixo } = partesDoValor(valor);
  return (
    <div className={s.grande}>
      <dt>{rotulo}</dt>
      <dd>
        <b>
          {carregando ? (
            <Esqueleto forma="bloco" largura={88} altura={44} raio="mini" />
          ) : (
            <>
              {prefixo ? <small className={s.grandeUnidade}>{prefixo} </small> : null}
              {principal}
              {sufixo ? <small className={s.grandeUnidade}> {sufixo}</small> : null}
            </>
          )}
        </b>
        <span>{apoio}</span>
      </dd>
    </div>
  );
}

/** Uma linha do "Janete × equipe": rótulo, barra dividida e legenda. */
function Linha({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className={s.linha}>
      <h3 className={s.blocoTitulo}>{titulo}</h3>
      {children}
    </div>
  );
}

export const Resultado = memo(function Resultado({ ref, aoVoltarAoTopo }: { ref: Ref<HTMLElement>; aoVoltarAoTopo: () => void }) {
  const { painel, carregando } = usePainelDashboard();
  const { funil, resumo, custo } = painel;
  const admin = painel.papel === "admin";
  // a mesma regra da página (TelaDashboardFinal e Capitulos): sem lead novo, a linha de vazio
  const vazio = painel.vazio || funil.leadsNovos === 0;
  const origens = resumo.enviadasPorOrigem;
  const motivos = Object.entries(resumo.passados.porMotivo) as [MotivoHumano, number | undefined][];

  return (
    <section
      ref={ref}
      className={s.resultado}
      data-dash="resultado"
      data-vazio={vazio || undefined}
      aria-labelledby="dvf-resultado-titulo"
      aria-busy={carregando || undefined}
    >
      <header className={s.resultadoCab}>
        <h2 id="dvf-resultado-titulo" tabIndex={-1} className={s.titulo}>
          O resultado do período{" "}
          <em>
            <span className={s.tituloSep} aria-hidden="true">
              ·{" "}
            </span>
            {painel.periodo.rotulo}
          </em>
        </h2>
        {!vazio ? <p className={s.frase}>{funil.frase}</p> : null}
      </header>

      {vazio ? (
        <p className={s.vazioLinha}>Nenhum lead chegou neste período. O agora continua nos cartões de cima.</p>
      ) : (
        <>
          <div className={s.bloco}>
            <dl className={s.grandes}>
              <Grande rotulo="Ganhos" valor={numero(funil.ganhos)} apoio="vendas" carregando={carregando} />
              <Grande rotulo="Perdidos" valor={numero(funil.perdidos)} apoio="leads" carregando={carregando} />
              <Grande rotulo="Taxa de ganho" valor={funil.taxaGanhoPct !== null ? porcentagem(funil.taxaGanhoPct) : "—"} apoio="dos leads novos" carregando={carregando} />
              <Grande rotulo="Ciclo até o ganho" valor={funil.cicloMedianoDias !== null ? dias(funil.cicloMedianoDias) : "—"} apoio="mediana" carregando={carregando} />
              {admin && custo ? (
                <Grande
                  rotulo="Custo por venda"
                  valor={custo.porGanhoUsd !== null ? dinheiro(custo.porGanhoUsd) : "—"}
                  apoio={custo.porGanhoUsd !== null ? "de IA por ganho" : "sem venda no período"}
                  carregando={carregando}
                />
              ) : null}
            </dl>
            <p className={s.encerramento}>{painel.textos.resultado}</p>
          </div>

          {carregando ? (
            <div className={s.resultadoBlocos} data-admin={admin && custo ? "" : undefined}>
              <BlocoOsso titulo="Janete × equipe" linhas={6} />
              {admin && custo ? (
                <div className={s.resultadoColuna}>
                  <BlocoOsso titulo="Custo de IA no período" linhas={4} />
                  <BlocoOsso titulo="Por modelo e provedor" linhas={3} />
                </div>
              ) : null}
            </div>
          ) : (
          <div className={s.resultadoBlocos} data-admin={admin && custo ? "" : undefined}>
            <div className={s.bloco}>
              <h3 className={s.blocoTitulo}>Janete × equipe</h3>
              <div className={s.linhas}>
                <Linha titulo="Resolvidas só pela Janete">
                  <p className={s.apoio} data-forte="">
                    <b>{resumo.autonomiaPct.atual !== null ? porcentagem(resumo.autonomiaPct.atual) : "—"}</b> <Variacao tendencia={resumo.autonomiaPct} />
                  </p>
                  <p className={s.apoio}>
                    a Janete passou {numero(resumo.passados.janetePassou)} · parou por falha em {numero(resumo.passados.falha)}
                  </p>
                </Linha>
                <Linha titulo="Mensagens enviadas, por origem">
                  <span className={s.trilho} role="img" aria-label={ORIGENS.map((o) => `${o.nome}: ${numero(origens[o.id])}`).join("; ")}>
                    {ORIGENS.map((o) => (
                      <span key={o.id} data-tom={o.tom} style={parte(origens[o.id])} />
                    ))}
                  </span>
                  <ul className={s.legenda}>
                    {ORIGENS.map((o) => (
                      <li key={o.id}>
                        <i data-tom={o.tom} aria-hidden="true" />
                        {o.nome} {numero(origens[o.id])}
                      </li>
                    ))}
                  </ul>
                </Linha>
                <Linha titulo="Movimentos no funil">
                  <span className={s.trilho} role="img" aria-label={`A Janete moveu ${numero(funil.movimentos.janete)}, a equipe moveu ${numero(funil.movimentos.equipe)}`}>
                    <span data-tom="janete" style={parte(funil.movimentos.janete)} />
                    <span data-tom="equipe" style={parte(funil.movimentos.equipe)} />
                  </span>
                  <ul className={s.legenda}>
                    <li>
                      <i data-tom="janete" aria-hidden="true" />a Janete {numero(funil.movimentos.janete)}
                    </li>
                    <li>
                      <i data-tom="equipe" aria-hidden="true" />a equipe {numero(funil.movimentos.equipe)}
                    </li>
                  </ul>
                </Linha>
                <Linha titulo="Passagens para a equipe, por motivo">
                  {motivos.length ? (
                    <dl className={s.pares}>
                      {motivos.map(([motivo, n]) => (
                        <div key={motivo}>
                          <dt>{rotuloMotivo(MOTIVO_CURTO[motivo], admin)}</dt>
                          <dd>{numero(n ?? 0)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className={s.apoio}>Nenhuma passagem no período.</p>
                  )}
                </Linha>
              </div>
            </div>

            {admin && custo ? (
              <div className={s.resultadoColuna}>
                <div className={s.bloco}>
                  <h3 className={s.blocoTitulo}>Custo de IA no período</h3>
                  <p className={s.apoio} data-forte="">
                    <b>{custo.total.atual !== null ? dinheiro(custo.total.atual) : "—"}</b> <Variacao tendencia={custo.total} custo />
                  </p>
                  {/* o mesmo gráfico por dia dos capítulos (azul claro, com o destaque só no pico) */}
                  {resumo.series.custoUsd ? (
                    <BarrasDia pontos={resumo.series.custoUsd} rotulo="Custo de IA por dia, em dólar" formatar={dinheiro} className={s.custoDia} />
                  ) : null}
                  {custo.previsaoMesUsd !== null ? <p className={s.apoio}>previsão do mês: {dinheiro(custo.previsaoMesUsd, { casas: 0 })}</p> : null}
                  <table className={s.tabela}>
                    <caption>Por tipo</caption>
                    <tbody>
                      <tr>
                        <th scope="row">respostas</th>
                        <td>{dinheiro(custo.porTipo.resposta)}</td>
                      </tr>
                      <tr>
                        <th scope="row">transcrição de áudio</th>
                        <td>{dinheiro(custo.porTipo.transcricao)}</td>
                      </tr>
                      {/* decisão 9d: o custo da IA no onboarding entra no total, numa linha própria */}
                      <tr>
                        <th scope="row">onboarding</th>
                        <td>{dinheiro(custo.porTipo.onboarding)}</td>
                      </tr>
                      {/* D7 da spec do uso da voz: a voz da Janete entra no total, numa linha própria */}
                      <tr>
                        <th scope="row">voz da Janete</th>
                        <td>{dinheiro(custo.porTipo.fala)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {custo.foraDaCoorteUsd > 0 ? (
                    <p className={s.honesta}>
                      {dinheiro(custo.foraDaCoorteUsd)} foram gastos com leads que chegaram antes deste período; por isso a soma por etapa fica menor que o total das
                      respostas.
                    </p>
                  ) : null}
                </div>
                <div className={s.bloco}>
                  <h3 className={s.blocoTitulo}>Por modelo e provedor</h3>
                  {custo.porModelo.length ? (
                    <table className={s.tabela}>
                      <thead>
                        <tr>
                          <th scope="col">modelo</th>
                          <th scope="col">provedor</th>
                          <th scope="col">US$</th>
                        </tr>
                      </thead>
                      <tbody>
                        {custo.porModelo.map((m) => (
                          <tr key={`${m.provedor}-${m.modelo}`}>
                            <th scope="row" className={s.modelo}>
                              {m.modelo}
                            </th>
                            <td>{nomeProvedor(m.provedor)}</td>
                            <td>{dinheiro(m.usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className={s.apoio}>Nenhuma chamada no período.</p>
                  )}
                  {custo.semPreco > 0 ? (
                    <p className={s.honesta}>
                      O custo pode estar um pouco abaixo do real: {contagem(custo.semPreco, "chamada não tem", "chamadas não têm")} preço na tabela. Tudo em US$.
                    </p>
                  ) : (
                    <p className={s.honesta}>Todas as chamadas do período têm preço na tabela. Tudo em US$.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          )}
        </>
      )}

      <div className={s.resultadoPe}>
        <Botao variante="contorno" tamanho="compacto" icone={<ArrowUp size={16} strokeWidth={2} />} onClick={aoVoltarAoTopo}>
          Voltar ao topo
        </Botao>
      </div>
    </section>
  );
});
