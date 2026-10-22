/** Icônes en SVG plutôt qu'en caractères texte. `✕ ! i ↳ ← →` rendaient au gré de la police du
 *  système, et `DESIGN.md` refuse de les canoniser. Toutes héritent de `currentColor` et se
 *  dimensionnent en `em`, donc elles suivent la couleur et la taille de leur contexte. */
type IconProps = { className?: string };

function Glyph({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-[1em] shrink-0 ${className ?? ""}`}
    >
      {children}
    </svg>
  );
}

export function ErrorIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </Glyph>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 3.5v5.5" />
      <path d="M8 12.2v.3" />
    </Glyph>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 7.2v5.3" />
      <path d="M8 3.5v.3" />
    </Glyph>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 8H4" />
      <path d="M7 5L4 8l3 3" />
    </Glyph>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 8h8" />
      <path d="M9 5l3 3-3 3" />
    </Glyph>
  );
}
