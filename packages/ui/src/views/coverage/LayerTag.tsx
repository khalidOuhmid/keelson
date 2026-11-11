import { findLayer, type LayerFamily, type LayerId } from "@keelson/taxonomy";

const TONE: Record<LayerFamily, string> = {
  build: "border-layer-build text-layer-build",
  test: "border-layer-test text-layer-test",
  operate: "border-layer-operate text-layer-operate",
  platform: "border-border-default text-text-secondary",
};

/** Colour groups the family, the word names the layer: a layer is never read from its hue. */
export function LayerTag({ layer }: { layer: LayerId }) {
  const { short, family, name } = findLayer(layer);
  return (
    <span
      title={name}
      data-family={family}
      className={`min-w-0 truncate rounded-sm border px-1 text-2xs tracking-label uppercase ${TONE[family]}`}
    >
      {short}
    </span>
  );
}

export function LayerTags({ layers, limit }: { layers: readonly LayerId[]; limit?: number }) {
  const shown = limit === undefined ? layers : layers.slice(0, limit);
  const hidden = layers.length - shown.length;
  return (
    <>
      {shown.map((layer) => (
        <LayerTag key={layer} layer={layer} />
      ))}
      {hidden > 0 ? (
        <span className="shrink-0 font-mono text-2xs text-text-muted tabular-nums">+{hidden}</span>
      ) : null}
    </>
  );
}
