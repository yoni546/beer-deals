import { useRef, useState } from "react";
import { BottleArt } from "@/components/ui/Bottle";
import { BLANK_BOTTLE, SHAPES } from "@/design/bottles";
import { identityFor, photoFor, pourFor, type Pour } from "@/design/themes";
import type { Beer } from "@/lib/db/types";

export type Scene = "name" | "pick" | "rank" | "reveal";

/**
 * The stage at the top of onboarding: the bottles themselves, standing on the counter.
 *
 *   name    one unlabelled bottle, centre stage — nobody's beer yet;
 *   pick    its cap comes off and it steps to the head of a line of four; each beer chosen
 *           turns into place as its own real bottle;
 *   rank    the same line follows the ranking, and whoever is #1 stands tallest. A bottle can be
 *           dragged along the line to change its place (the list below does the same in words);
 *   reveal  the other three step back, #1 loses its cap and pours itself a glass.
 *
 * Depth is faked, on purpose: the bottles are the approved product photos (shown as photographed —
 * a 3D mesh would mean redrawing the label), turned a few degrees in CSS perspective with a band of
 * light crossing the glass. Every moving property is a transform or an opacity, so it stays on the
 * compositor on a mid-range phone; src/app/welcome/onboarding.css holds the choreography.
 *
 * Decorative throughout (aria-hidden): the steps below say everything in words.
 */
export function OnboardingStage({ scene, picked, onMove }: { scene: Scene; picked: Beer[]; onMove?: (from: number, to: number) => void }) {
  const primary = picked[0];
  const pour = pourFor(primary?.slug);
  const kind = !primary ? "none" : photoFor(primary.slug) ? "photo" : identityFor(primary.slug).bottle ? "drawn" : "none";

  // --- dragging a bottle along the line (rank scene) ------------------------------
  const stage = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const canDrag = scene === "rank" && Boolean(onMove);

  /** The place in the line nearest to a point on the screen: the rank badges mark the places. */
  function placeAt(clientX: number): number {
    const badges = [...(stage.current?.querySelectorAll<HTMLElement>(".ob-badge") ?? [])].slice(0, picked.length);
    let nearest = 0;
    let best = Infinity;
    badges.forEach((badge, rank) => {
      const box = badge.getBoundingClientRect();
      const distance = Math.abs(box.left + box.width / 2 - clientX);
      if (distance < best) [best, nearest] = [distance, rank];
    });
    return nearest;
  }

  const dragHandlers = (beer: Beer, rank: number) =>
    canDrag
      ? {
          onPointerDown: (event: React.PointerEvent) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            setDragging(beer.id);
          },
          onPointerMove: (event: React.PointerEvent) => {
            if (dragging !== beer.id) return;
            const to = placeAt(event.clientX);
            if (to !== rank) onMove?.(rank, to);
          },
          onPointerUp: () => setDragging(null),
          onPointerCancel: () => setDragging(null),
        }
      : {};

  return (
    <div
      ref={stage}
      aria-hidden
      className="ob-stage"
      data-scene={scene}
      data-beer={primary?.slug ?? "house"}
      data-bottle={kind}
      style={{ "--pour": pour.beer, "--foam": pour.foam } as React.CSSProperties}
    >
      {[0, 1, 2, 3].map((rank) => {
        const beer = picked[rank];
        if (beer) return <StageBottle key={beer.id} slug={beer.slug} rank={rank} dragging={dragging === beer.id} handlers={dragHandlers(beer, rank)} />;
        return rank === 0 ? <StageBottle key="blank" slug={null} rank={0} /> : <EmptySlot key={`empty-${rank}`} rank={rank} />;
      })}

      {[0, 1, 2, 3].map((rank) => (
        <span key={rank} data-rank={rank} className={`ob-badge num ${rank === 0 ? "bg-deal text-on-deal" : "text-on-ground-2 ring-1 ring-ground-line"}`}>
          {rank + 1}
        </span>
      ))}

      <span className="ob-stream">
        <i />
      </span>
      <Glass shape={pour.glass} />
    </div>
  );
}

/** One bottle in the line: the beer's photo, else its drawn bottle, else the unlabelled one. */
function StageBottle({ slug, rank, dragging = false, handlers = {} }: { slug: string | null; rank: number; dragging?: boolean; handlers?: React.HTMLAttributes<HTMLDivElement> }) {
  const photo = slug ? photoFor(slug) : null;
  const drawn = slug ? identityFor(slug).bottle : null;
  const blank = !photo && !drawn;
  const ratio = photo ? `${photo.width} / ${photo.height}` : blank ? "240 / 920" : "200 / 820";

  return (
    <div
      className={`ob-item ${blank ? "ob-blank" : ""}`}
      data-rank={rank}
      data-dragging={dragging || undefined}
      style={{ aspectRatio: ratio, "--cap": photo?.cap ? `${photo.cap * 100}%` : undefined } as React.CSSProperties}
      {...handlers}
    >
      <div className="ob-tilt">
        <div className="ob-turn">
          {photo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a small, already-optimised WebP; next/image adds nothing here */}
              <img className={`ob-art ${photo.cap ? "ob-body" : ""}`} src={photo.src} width={photo.width} height={photo.height} alt="" decoding="async" draggable={false} />
              {/* The same photo again, showing only its cap: on the last step the real cap comes off. */}
              {photo.cap && (
                // eslint-disable-next-line @next/next/no-img-element -- as above
                <img className="ob-art ob-cap" src={photo.src} width={photo.width} height={photo.height} alt="" decoding="async" draggable={false} />
              )}
              <span className="ob-sheen" style={{ "--mask": `url(${photo.src})` } as React.CSSProperties} />
            </>
          ) : drawn ? (
            <BottleArt spec={drawn} idPrefix={`ob-${slug}`} className="ob-art" />
          ) : (
            <BlankBottle />
          )}
        </div>
      </div>
      {blank && (
        <span className="ob-fizz">
          {[-140, -40, 60, 150].map((dx, index) => (
            <i key={dx} style={{ "--dx": `${dx}%`, animationDelay: `${180 + index * 80}ms` } as React.CSSProperties} />
          ))}
        </span>
      )}
    </div>
  );
}

/** A place in the line nobody stands in yet. */
function EmptySlot({ rank }: { rank: number }) {
  return (
    <div className="ob-item ob-empty" data-rank={rank} style={{ aspectRatio: "200 / 820" }}>
      <svg viewBox="0 0 200 820" className="ob-art" focusable="false">
        <path d={SHAPES.classic.outline} fill="none" stroke="currentColor" strokeWidth="7" strokeDasharray="22 20" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// Condensation on the unlabelled bottle: the same scatter on every render (a fixed seed), kept off the label.
const DROPLETS = (() => {
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const drops: Array<{ x: number; y: number; r: number }> = [];
  while (drops.length < 46) {
    const y = 330 + next() * 540;
    if (y > 500 && y < 780) continue; // the label
    drops.push({ x: 36 + next() * 168, y, r: 1.6 + next() * 3.4 });
  }
  return drops;
})();

/**
 * The bottle nobody has claimed yet, drawn at a real long-neck's proportions: lit amber glass with
 * beer glowing through it, a blank paper label ruled like a receipt, cold enough to bead. The crown
 * is its own group (.bottle-cap) so it can come off.
 */
function BlankBottle() {
  const { glass, label, labelShade, cap, capShade } = BLANK_BOTTLE;
  const outline = "M86 56 L86 230 C86 320 24 340 24 425 L24 870 Q24 900 54 900 L186 900 Q216 900 216 870 L216 425 C216 340 154 320 154 230 L154 56 Z";
  return (
    <svg viewBox="0 0 240 920" className="ob-art ob-house" focusable="false">
      <defs>
        <linearGradient id="ob-blank-glass" x1="0" x2="1" y1="0" y2="0">
          {glass.map((stop, index) => (
            <stop key={index} offset={[0, 0.14, 0.34, 0.56, 0.84, 1][index]} stopColor={stop} />
          ))}
        </linearGradient>
        {/* Down the bottle: a dark neck, the beer lit from behind lower down, a heavy base. */}
        <linearGradient id="ob-blank-depth" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.3" />
          <stop offset="0.32" stopColor="#000" stopOpacity="0.08" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="0.94" stopColor="#000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.38" />
        </linearGradient>
        <linearGradient id="ob-blank-paper" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={labelShade} />
          <stop offset="0.2" stopColor={label} />
          <stop offset="0.72" stopColor={label} />
          <stop offset="1" stopColor={labelShade} />
        </linearGradient>
        <linearGradient id="ob-blank-cap" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={capShade} />
          <stop offset="0.3" stopColor={cap} />
          <stop offset="0.45" stopColor="#fff" />
          <stop offset="0.62" stopColor={cap} />
          <stop offset="1" stopColor={capShade} />
        </linearGradient>
        <filter id="ob-blank-soft" x="-50%" y="-5%" width="200%" height="110%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
        <clipPath id="ob-blank-clip">
          <path d={outline} />
        </clipPath>
      </defs>

      <path d={outline} fill="url(#ob-blank-glass)" />
      <g clipPath="url(#ob-blank-clip)">
        <rect width="240" height="920" fill="url(#ob-blank-depth)" />
        {/* The air above the beer, in the neck. */}
        <rect y="56" width="240" height="72" fill="#000" opacity="0.16" />

        {DROPLETS.map(({ x, y, r }, index) => (
          <g key={index}>
            <ellipse cx={x} cy={y} rx={r} ry={r * 1.25} fill="#fff" opacity="0.13" />
            <circle cx={x - r * 0.3} cy={y - r * 0.4} r={r * 0.32} fill="#fff" opacity="0.5" />
          </g>
        ))}

        {/* Blank paper, ruled like a receipt: nobody's name on it yet. */}
        <rect y="150" width="240" height="62" fill="url(#ob-blank-paper)" />
        <rect y="520" width="240" height="240" fill="url(#ob-blank-paper)" />
        <path d="M0 540 H240 M0 740 H240" stroke={labelShade} strokeWidth="2.5" />
        <path d="M50 640 H190" stroke={labelShade} strokeWidth="4" strokeDasharray="2 11" strokeLinecap="round" />

        {/* Light on the glass: a long soft streak down the lit side, a thin one on the far rim. */}
        <rect x="48" y="420" width="18" height="450" rx="9" fill="#fff" opacity="0.34" filter="url(#ob-blank-soft)" />
        <rect x="98" y="80" width="9" height="160" rx="4.5" fill="#fff" opacity="0.3" filter="url(#ob-blank-soft)" />
        <rect x="200" y="450" width="4" height="400" rx="2" fill="#fff" opacity="0.2" />
      </g>
      <path d={outline} fill="none" stroke={glass[2]} strokeWidth="2" opacity="0.55" />

      <g className="bottle-cap">
        <path d="M79 26 Q79 18 89 18 L151 18 Q161 18 161 26 L164 52 L76 52 Z" fill="url(#ob-blank-cap)" />
        {/* The crimped skirt. */}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((tooth) => (
          <circle key={tooth} cx={80 + tooth * 10} cy="53" r="5" fill={tooth % 2 ? cap : capShade} />
        ))}
      </g>
    </svg>
  );
}

/** Each kind of beer in its own glass: a pint, a tall wheat-beer glass, a stout's tulip. */
const GLASSES: Record<Pour["glass"], { outline: string; shine: string }> = {
  pint: { outline: "M12 4 L88 4 L80 132 Q80 137 75 137 L25 137 Q20 137 20 132 Z", shine: "M27 18 L31 116" },
  weizen: {
    outline: "M20 4 L80 4 C86 42 71 68 69 96 C68 112 73 122 71 133 Q70 137 66 137 L34 137 Q30 137 29 133 C27 122 32 112 31 96 C29 68 14 42 20 4 Z",
    shine: "M31 18 C31 44 38 64 38 92",
  },
  tulip: {
    outline: "M17 4 L83 4 C91 34 81 62 77 88 L73 132 Q73 137 68 137 L32 137 Q27 137 27 132 L23 88 C19 62 9 34 17 4 Z",
    shine: "M28 18 C27 40 32 62 34 92",
  },
};

/** The glass #1 pours into. Drawn in the counter's own ink; only the beer and its head are beer-coloured. */
function Glass({ shape }: { shape: Pour["glass"] }) {
  const { outline, shine } = GLASSES[shape];
  return (
    <svg viewBox="0 0 100 140" className="ob-glass" data-glass={shape} focusable="false">
      <defs>
        <clipPath id="ob-glass-clip">
          <path d={outline} />
        </clipPath>
      </defs>
      <path d={outline} className="ob-glass-body" />
      <g clipPath="url(#ob-glass-clip)">
        <g className="ob-liquid">
          <rect x="0" y="0" width="100" height="140" fill="var(--pour)" />
          {[30, 52, 68].map((cx, index) => (
            <circle key={cx} className="ob-bubble" cx={cx} cy={92 - index * 14} r="2.2" fill="var(--foam)" style={{ animationDelay: `${3.6 + index * 0.9}s` }} />
          ))}
          {/* The head: a body of foam with an uneven, bubbly top. */}
          <g className="ob-head" fill="var(--foam)">
            <rect x="0" y="-24" width="100" height="24" />
            {[10, 27, 44, 61, 78, 93].map((cx, index) => (
              <circle key={cx} cx={cx} cy={-24} r={7 + (index % 3) * 1.5} />
            ))}
          </g>
        </g>
      </g>
      <path d={outline} className="ob-glass-rim" />
      <path d={shine} className="ob-glass-shine" />
    </svg>
  );
}
