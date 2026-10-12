import { SHAPES, shade, type BottleSpec } from "@/design/bottles";
import { identityFor, photoFor, toneTransfer, type Mode, type ThemePreset } from "@/design/themes";

/**
 * A drawn bottle: the real silhouette, glass, cap and label colours of a beer — and no logo,
 * wordmark or label art (see src/design/bottles.ts for why). Used large, on the counter, as
 * favourite #1's backdrop, and small as a marker next to a beer's name.
 *
 * `idPrefix` keeps the gradient ids unique when several bottles are on one page.
 */
export function BottleArt({ spec, idPrefix, className = "", style }: { spec: BottleSpec; idPrefix: string; className?: string; style?: React.CSSProperties }) {
  const g = SHAPES[spec.shape];
  const id = (name: string) => `${idPrefix}-${name}`;
  const labelH = g.label.bottom - g.label.top;
  const capX = 100 - g.cap.w / 2;

  return (
    <svg viewBox="0 0 200 820" className={className} style={style} aria-hidden focusable="false" preserveAspectRatio="xMidYMax meet">
      <defs>
        <linearGradient id={id("glass")} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={shade(spec.glass, -0.08)} />
          <stop offset="0.2" stopColor={shade(spec.glass, 0.12)} />
          <stop offset="0.42" stopColor={spec.glass} />
          <stop offset="0.82" stopColor={shade(spec.glass, -0.07)} />
          <stop offset="1" stopColor={shade(spec.glass, -0.14)} />
        </linearGradient>
        <linearGradient id={id("round")} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.28" />
          <stop offset="0.25" stopColor="#000" stopOpacity="0" />
          <stop offset="0.72" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.34" />
        </linearGradient>
        <clipPath id={id("clip")}>
          <path d={g.outline} />
        </clipPath>
      </defs>

      {/* Glass */}
      <path d={g.outline} fill={`url(#${id("glass")})`} />

      <g clipPath={`url(#${id("clip")})`}>
        {/* Beer seen through clear glass */}
        {spec.liquid && <rect x="0" y={g.fill} width="200" height={820 - g.fill} fill={spec.liquid} opacity="0.82" />}

        {/* Neck foil */}
        <rect x="0" y={g.neck.top} width="200" height={g.neck.bottom - g.neck.top} fill={spec.neck} />
        <rect x="0" y={g.neck.bottom - 6} width="200" height="3" fill={spec.label.detail} opacity="0.9" />

        {/* Body label: colours only, never text or a mark */}
        {spec.label.form === "band" && (
          <>
            <rect x="0" y={g.label.top} width="200" height={labelH} fill={spec.label.base} />
            <rect x="0" y={g.label.top + 10} width="200" height="6" fill={spec.label.band} />
            <rect x="0" y={g.label.bottom - 16} width="200" height="6" fill={spec.label.band} />
            <rect x="0" y={g.label.top + labelH * 0.46} width="200" height={labelH * 0.12} fill={spec.label.detail} />
          </>
        )}
        {spec.label.form === "oval" && (
          <>
            <ellipse cx="100" cy={g.label.top + labelH / 2} rx="54" ry={labelH / 2} fill={spec.label.base} />
            <ellipse cx="100" cy={g.label.top + labelH / 2} rx="54" ry={labelH / 2} fill="none" stroke={spec.label.band} strokeWidth="7" />
            <rect x="50" y={g.label.top + labelH * 0.44} width="100" height={labelH * 0.12} fill={spec.label.detail} />
          </>
        )}
        {spec.label.form === "shield" && (
          <>
            <path
              d={`M44 ${g.label.top + 40} Q100 ${g.label.top - 26} 156 ${g.label.top + 40} L156 ${g.label.bottom - 16} Q100 ${g.label.bottom + 12} 44 ${g.label.bottom - 16} Z`}
              fill={spec.label.base}
            />
            <rect x="0" y={g.label.top + labelH * 0.5} width="200" height={labelH * 0.1} fill={spec.label.band} />
            <circle cx="100" cy={g.label.top + labelH * 0.28} r="13" fill={spec.label.detail} />
          </>
        )}

        {/* Roundness and light: dark edges, a specular streak, a rim on the far side */}
        <rect x="0" y="0" width="200" height="820" fill={`url(#${id("round")})`} />
        <rect x="58" y={g.neck.bottom + 40} width="9" height={760 - g.neck.bottom} rx="4.5" fill="#fff" opacity="0.3" />
        <rect x="84" y={g.cap.y + g.cap.h + 6} width="5" height={g.neck.bottom - g.cap.y} rx="2.5" fill="#fff" opacity="0.22" />
        <rect x="148" y={g.neck.bottom + 80} width="3" height={640 - g.neck.bottom} rx="1.5" fill="#fff" opacity="0.14" />
      </g>

      {/* Rim light: the glass edge catches the light, so even dark glass reads as a bottle on a dark counter */}
      <path d={g.outline} fill="none" stroke={shade(spec.glass, 0.32)} strokeWidth="3.5" opacity="0.9" />

      {/* Crown cap (its own group: onboarding pops it off) */}
      <g className="bottle-cap">
        <rect x={capX} y={g.cap.y} width={g.cap.w} height={g.cap.h} rx="5" fill={spec.cap} />
        <rect x={capX} y={g.cap.y + g.cap.h - 7} width={g.cap.w} height="7" fill={shade(spec.cap, -0.1)} />
        <rect x={capX + 6} y={g.cap.y + 4} width="6" height={g.cap.h - 12} rx="3" fill="#fff" opacity="0.28" />
      </g>
    </svg>
  );
}

/**
 * The tone filters (light and dark) that keep every counter text readable over the bottle. Two
 * depths: the hero bottle is almost in focus (its label reads, so the beer is recognised at a
 * glance); the supporting bottles at the sides sit further back, softer. Both squeeze colour into the
 * same safe range — the range, not the blur, is what guarantees contrast.
 */
function ToneFilters({ preset }: { preset: ThemePreset }) {
  const filter = (mode: Mode, depth: "hero" | "soft") => {
    const { amplitude, exponent, offset } = toneTransfer(preset, mode);
    const fn = { type: "gamma", amplitude: amplitude.toFixed(4), exponent: String(exponent), offset: offset.toFixed(4) } as const;
    return (
      <filter
        key={`${mode}-${depth}`}
        id={depth === "hero" ? `bottle-tone-${mode}` : `bottle-tone-soft-${mode}`}
        x="-5%"
        y="-5%"
        width="110%"
        height="110%"
        colorInterpolationFilters="sRGB"
      >
        {/* Richer colour first, then squeeze into the safe range — the range is what guarantees contrast. */}
        <feColorMatrix type="saturate" values="1.7" />
        <feComponentTransfer>
          <feFuncR {...fn} />
          <feFuncG {...fn} />
          <feFuncB {...fn} />
        </feComponentTransfer>
        {/* Depth of field: a touch for the hero (the label stays legible), more for the bottles behind it. */}
        <feGaussianBlur stdDeviation={depth === "hero" ? "0.6" : "3.2"} />
      </filter>
    );
  };
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
      {filter("light", "hero")}
      {filter("dark", "hero")}
      {filter("light", "soft")}
      {filter("dark", "soft")}
    </svg>
  );
}

/**
 * Favourite #1's bottle, standing on the counter behind everything, fixed while the paper scrolls:
 * one large hero bottle in the centre, its label in the open "stage" at the top of the screen, and
 * two smaller ones behind it at the sides — the same product, so the beer is obvious at a glance and
 * the composition reads as deliberate, not as wallpaper. A vignette and a top scrim give depth; the
 * tone filter — not the scrim — is what guarantees readability.
 */
export function BottleBackdrop({ preset }: { preset: ThemePreset }) {
  const { background, backgroundPosition, backgroundScale, beerId } = preset;
  if (background.kind === "none") return <div aria-hidden className="bottle-stage" data-bottle="none" data-beer={beerId} />;

  const style = {
    "--bottle-x": String(backgroundPosition.x),
    "--bottle-top": String(backgroundPosition.top),
    "--bottle-rotate": `${backgroundPosition.rotate}deg`,
    "--bottle-scale": String(backgroundScale),
  } as React.CSSProperties;

  return (
    <div aria-hidden className="bottle-stage" data-bottle={background.kind} data-beer={beerId} style={style}>
      <ToneFilters preset={preset} />
      {(["side-start", "side-end", "hero"] as const).map((place) => {
        const className = place === "hero" ? "bottle-art bottle-hero" : `bottle-art bottle-side bottle-${place}`;
        return background.kind === "photo" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a fixed decorative layer; next/image adds nothing here
          <img
            key={place}
            className={className}
            src={background.photo.src}
            width={background.photo.width}
            height={background.photo.height}
            alt=""
            decoding="async"
            fetchPriority={place === "hero" ? "high" : "low"}
          />
        ) : (
          <BottleArt key={place} spec={background.bottle} idPrefix={`stage-${beerId}-${place}`} className={className} />
        );
      })}
    </div>
  );
}

/**
 * A small bottle beside a beer's name, so a beer is recognised before its name is read. Beers
 * without an identity get a plain outline bottle in the ink colour — never another beer's colours.
 */
export function BeerMark({ slug, height = 36, className = "" }: { slug: string; height?: number; className?: string }) {
  const spec = identityFor(slug).bottle;
  const width = Math.round((height * 200) / 820);
  if (!spec) {
    return (
      <svg viewBox="0 0 200 820" width={width} height={height} className={className} aria-hidden focusable="false">
        <path d={SHAPES.classic.outline} fill="none" stroke="currentColor" strokeWidth="18" opacity="0.55" />
      </svg>
    );
  }
  return <BottleArt spec={spec} idPrefix={`mark-${slug}-${height}`} className={className} style={{ width, height }} />;
}

/**
 * A beer's own bottle, small: the real product photo when there is one (as photographed — the same
 * approved files as the counter), else the drawn bottle. Decorative: the beer's name is always beside it.
 *
 * At list sizes it takes the 216 px thumbnail rather than the hero asset. Home's four keys were
 * fetching up to 292 KiB of imagery to paint four 19×72 boxes; the same four are now ~20 KB.
 *
 * `eager` is for the ones above the fold. Home's keys sit in the header, where lazy-loading only
 * defers the request past layout for no benefit.
 */
export function BeerBottle({
  slug,
  height = 72,
  className = "",
  eager = false,
}: {
  slug: string;
  height?: number;
  className?: string;
  eager?: boolean;
}) {
  const photo = photoFor(slug);
  if (!photo) return <BeerMark slug={slug} height={height} className={className} />;
  // 216 px covers a 72 px box at DPR 3 exactly, and the 52 px list comfortably.
  const asset = height <= 96 && photo.thumb ? photo.thumb : photo;
  const width = Math.round((height * asset.width) / asset.height);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small, already-optimised WebP; next/image adds nothing here
    <img
      src={asset.src}
      alt=""
      width={width}
      height={height}
      data-bottle-photo={slug}
      className={`object-contain ${className}`}
      style={{ width, height }}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
