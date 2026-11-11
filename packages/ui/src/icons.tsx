/** Icons as SVG rather than text characters. `✕ ! i ↳ ← →` rendered at the whim of the system
 *  font, and `DESIGN.md` refuses to canonise them. All inherit `currentColor` and are sized in
 *  `em`, so they follow the colour and size of their context. */
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

/** A triangle, not a bar topped by a dot: the previous version was a near-twin of `InfoIcon` and
 *  the two were indistinguishable at the smallest step of the scale. */
export function WarningIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 2.2L14.4 13.4H1.6z" />
      <path d="M8 6.4v3" />
      <path d="M8 11.2v.3" />
    </Glyph>
  );
}

/** A disc, so that the mark differs from the warning triangle by its silhouette rather than by an
 *  inner detail. */
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

/** Inheritance mark, in place of the `↳` character. */
export function InheritedIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 3v5a2 2 0 0 0 2 2H12" />
      <path d="M9.5 7.5l2.5 2.5-2.5 2.5" />
    </Glyph>
  );
}

/** Disclosure mark. Distinct from `ArrowRightIcon`: an arrow says "go there", a chevron says "this
 *  expands". It rotates 90° when the `details` is open. */
export function ChevronRightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 4l4 4-4 4" />
    </Glyph>
  );
}

/** A `simple-icons` logo: a filled path on a 24 grid. It inherits `currentColor`, so it stays
 *  within the product palette and imports no brand colour. */
export function LogoGlyph({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-[1em] shrink-0">
      <path d={path} />
    </svg>
  );
}

/** When no logo is allowed: a neutral mark, never an approximated logo. */
export const LAYER_GENERIC_GLYPH = (
  <Glyph>
    <path d="M4 3h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
  </Glyph>
);
