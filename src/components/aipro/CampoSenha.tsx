import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Campo, classesCampo as s, type PropsCampo } from "./Campo";

/**
 * Senha (ou chave de API) com opção de ver o que foi digitado. Ver antes de enviar
 * evita a ida e volta do erro. O rótulo do botão é fixo e o estado vai em
 * `aria-pressed`, como pede o padrão de botão de alternância.
 */
export function CampoSenha(
  props: Omit<PropsCampo, "type" | "sufixo"> & {
    /** Nome acessível do botão de ver (padrão "Mostrar senha"; na chave, "Mostrar chave"). */
    rotuloMostrar?: string | undefined;
  },
) {
  const { rotuloMostrar = "Mostrar senha", ...campo } = props;
  const [visivel, setVisivel] = useState(false);

  return (
    <Campo
      {...campo}
      type={visivel ? "text" : "password"}
      sufixo={
        <button
          type="button"
          className={s.alternar}
          aria-label={rotuloMostrar}
          aria-pressed={visivel}
          aria-controls={campo.id}
          onClick={() => setVisivel((atual) => !atual)}
        >
          {visivel ? (
            <EyeOff size={20} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Eye size={20} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      }
    />
  );
}
