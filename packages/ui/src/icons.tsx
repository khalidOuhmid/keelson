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

/** Un triangle, et non un trait surmonte d'un point : la version precedente etait une quasi-jumelle
 *  d'`InfoIcon` et les deux etaient indiscernables au plus petit
 *  degre de la rampe. */
export function WarningIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 2.2L14.4 13.4H1.6z" />
      <path d="M8 6.4v3" />
      <path d="M8 11.2v.3" />
    </Glyph>
  );
}

/** Un disque, pour que la marque se distingue du triangle d'avertissement par sa silhouette et non
 *  par un detail interieur. */
export function InfoIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.4v3.8" />
      <path d="M8 5v.3" />
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

/** Marque d'héritage, en place du caractère `↳`. */
export function InheritedIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 3v5a2 2 0 0 0 2 2H12" />
      <path d="M9.5 7.5l2.5 2.5-2.5 2.5" />
    </Glyph>
  );
}

/** Marque de pliage. Distincte d'`ArrowRightIcon` : une flèche dit « va là », un chevron dit
 *  « ceci se déplie ». Elle tourne de 90° quand le `details` est ouvert. */
export function ChevronRightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 4l4 4-4 4" />
    </Glyph>
  );
}

/** Un logo de `simple-icons` : un tracé plein sur une grille de 24. Il hérite de `currentColor`,
 *  donc il reste dans la palette du produit et n'importe aucune couleur de marque. */
export function LogoGlyph({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-[1em] shrink-0">
      <path d={path} />
    </svg>
  );
}

/** Quand aucun logo n'est autorisé : une marque neutre, jamais un logo approché. */
export const LAYER_GENERIC_GLYPH = (
  <Glyph>
    <path d="M4 3h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
  </Glyph>
);
