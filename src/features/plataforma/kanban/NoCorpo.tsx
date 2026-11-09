import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// O que flutua por cima do quadro (o aviso, a caixa "Editar etapas" e a prévia do card) vai para o
// `body` por portal, como a Gaveta. Dentro da `.vista` do VistaArea, que anima `transform` com `both`,
// um `position: fixed` passaria a se posicionar contra a seção (no Firefox), e não contra a janela.
// O contêiner leva `data-identidade="aipro"` para herdar a fonte e a cor da identidade.

export function NoCorpo({ children }: { children: ReactNode }) {
  // O portal só existe no navegador: no servidor (e no primeiro render da hidratação) não há `document`.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  return createPortal(<div data-identidade="aipro">{children}</div>, document.body);
}
