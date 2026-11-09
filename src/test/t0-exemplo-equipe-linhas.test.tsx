import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Lista } from "@/features/plataforma/chat/Lista";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { IDS, criarEstadoInicial, reduzir, type EstadoBase } from "@/features/plataforma/exemplo";
import { EtapaChat } from "@/features/plataforma/kanban/EtapaChat";
import { ProvedorPapel } from "@/features/plataforma/papel";

// A fundação da Equipe (docs/spec-equipe.md, F4) nas telas: depois de desativar a Marina, a conversa
// da Patrícia volta para a espera e as linhas do Chat (Lista → LinhaChat) e da etapa como chat do
// Kanban (EtapaChat → LinhaConversa) dizem com quem ela estava, no lugar de "Respondida pela tela".

// Sexta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");

afterEach(() => cleanup());

/** O exemplo com a Marina desativada pelo admin: as 3 conversas dela voltam para a espera. */
function semMarina(): EstadoBase {
  const r = reduzir(criarEstadoInicial(AGORA), {
    acao: { tipo: "desativarMembro", membroId: IDS.marina },
    euId: IDS.voce,
    agora: AGORA.toISOString(),
  });
  expect(r.resultado.ok).toBe(true);
  return r.estado;
}

function montar(filho: React.ReactNode, inicial: () => EstadoBase = semMarina) {
  return render(
    <ProvedorPapel inicial="admin">
      <ProvedorDados exemplo={inicial} progredirEnvios={false} relogio={() => AGORA}>
        {filho}
      </ProvedorDados>
    </ProvedorPapel>,
  );
}

describe("'Estava com Marina' nas linhas das conversas que voltaram para a espera", () => {
  it("na lista do Chat, a linha da Patrícia diz com quem estava", () => {
    montar(<Lista selecionadaId={null} aoAbrir={() => {}} agora={AGORA.getTime()} />);
    const patricia = screen.getByRole("button", { name: /^Patrícia Nogueira/ });
    expect(patricia.textContent + " " + patricia.getAttribute("aria-label")).toMatch(/estava com Marina/i);
    expect(patricia.textContent + " " + patricia.getAttribute("aria-label")).not.toMatch(/Respondida pela tela/);
  });

  it("sem a desativação, a mesma linha não fala de 'Estava com'", () => {
    montar(<Lista selecionadaId={null} aoAbrir={() => {}} agora={AGORA.getTime()} />, () => criarEstadoInicial(AGORA));
    const patricia = screen.getByRole("button", { name: /^Patrícia Nogueira/ });
    expect(patricia.textContent + " " + patricia.getAttribute("aria-label")).not.toMatch(/estava com/i);
  });

  it("na etapa como chat do Kanban, a linha da Patrícia diz com quem estava", () => {
    montar(<EtapaChat etapaId={IDS.etapa.em_negociacao} aoVoltar={() => {}} aoTrocarEtapa={() => {}} />);
    const lista = screen.getByRole("navigation", { name: "Conversas desta etapa" });
    const patricia = within(lista).getByRole("button", { name: /Patrícia Nogueira/ });
    const texto = patricia.textContent + " " + (patricia.getAttribute("aria-label") ?? "");
    expect(texto).toMatch(/estava com Marina/i);
    expect(texto).not.toMatch(/Respondida pela tela/);
  });
});
