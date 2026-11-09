import { BRAND_NAME, PRODUCT_LABEL, PRODUCT_NAME } from "@/lib/brand";

type Props = {
  withName?: boolean;
  onDark?: boolean;
  height?: number;
  className?: string;
};

export default function BrandLogo({
  withName = false,
  onDark = false,
  height = 38,
  className,
}: Props) {
  return (
    <span
      role="img"
      aria-label={PRODUCT_NAME}
      className={["aipro-brand", onDark && "aipro-brand--inverse", className].filter(Boolean).join(" ")}
    >
      <img
        src="/brand/aipro-icone.png"
        alt=""
        width={height}
        height={height}
        className="aipro-brand__symbol"
      />
      {withName && (
        <span className="aipro-brand__name" aria-hidden="true">
          <span className="aipro-brand__maker">{BRAND_NAME}</span>
          <span className="aipro-brand__product">{PRODUCT_LABEL}</span>
        </span>
      )}
    </span>
  );
}
