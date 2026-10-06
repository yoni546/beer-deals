import { useRef, useState } from "react";
import { BottleArt } from "@/components/ui/Bottle";
import { SHAPES } from "@/design/bottles";
import opening from "@/design/opening-bottle.json";
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

/** One bottle in the line: the beer's photo, else its drawn bottle, else the unlabelled one (a beer with no identity). */
function StageBottle({ slug, rank, dragging = false, handlers = {} }: { slug: string | null; rank: number; dragging?: boolean; handlers?: React.HTMLAttributes<HTMLDivElement> }) {
  const photo = slug ? photoFor(slug) : null;
  const drawn = slug ? identityFor(slug).bottle : null;
  const blank = !photo && !drawn;
  const ratio = photo ? `${photo.width} / ${photo.height}` : blank ? `${opening.bottle.width} / ${opening.bottle.height}` : "200 / 820";

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
            // Nobody's bottle: a render of our own (scripts/render-opening-bottle.mjs), its crown a separate
            // piece standing where it was rendered, so it can come off.
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
              <img className="ob-art" src={opening.bottle.src} width={opening.bottle.width} height={opening.bottle.height} alt="" decoding="async" draggable={false} />
              {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
              <img
                className="bottle-cap"
                src={opening.cap.src}
                alt=""
                decoding="async"
                draggable={false}
                style={{ left: `${opening.cap.left * 100}%`, top: `${opening.cap.top * 100}%`, width: `${opening.cap.width * 100}%` }}
              />
              <span className="ob-sheen" style={{ "--mask": `url(${opening.bottle.src})` } as React.CSSProperties} />
            </>
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
