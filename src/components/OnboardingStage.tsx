import { BottleArt } from "@/components/ui/Bottle";
import { BLANK_BOTTLE, SHAPES } from "@/design/bottles";
import { identityFor, photoFor, pourFor } from "@/design/themes";
import type { Beer } from "@/lib/db/types";

export type Scene = "name" | "pick" | "rank" | "reveal";

/**
 * The stage at the top of onboarding: the bottles themselves, standing on the counter.
 *
 *   name    one unlabelled bottle, centre stage — nobody's beer yet;
 *   pick    its cap comes off and it steps to the head of a line of four; each beer chosen
 *           turns into place as its own real bottle;
 *   rank    the same line follows the ranking, and whoever is #1 stands tallest;
 *   reveal  the other three step back, #1 pours itself a glass.
 *
 * Depth is faked, on purpose: the bottles are the approved product photos (shown as photographed —
 * a 3D mesh would mean redrawing the label), turned a few degrees in CSS perspective with a band of
 * light crossing the glass. Every moving property is a transform or an opacity, so it stays on the
 * compositor on a mid-range phone; src/app/welcome/onboarding.css holds the choreography.
 *
 * Decorative throughout (aria-hidden): the steps below say everything in words.
 */
export function OnboardingStage({ scene, picked }: { scene: Scene; picked: Beer[] }) {
  const primary = picked[0];
  const pour = pourFor(primary?.slug);
  const kind = !primary ? "none" : photoFor(primary.slug) ? "photo" : identityFor(primary.slug).bottle ? "drawn" : "none";

  return (
    <div
      aria-hidden
      className="ob-stage"
      data-scene={scene}
      data-beer={primary?.slug ?? "house"}
      data-bottle={kind}
      style={{ "--pour": pour.beer, "--foam": pour.foam } as React.CSSProperties}
    >
      {[0, 1, 2, 3].map((rank) => {
        const beer = picked[rank];
        if (beer) return <StageBottle key={beer.id} slug={beer.slug} rank={rank} />;
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
      <Glass />
    </div>
  );
}

/** One bottle in the line: the beer's photo, else its drawn bottle, else the blank one. */
function StageBottle({ slug, rank }: { slug: string | null; rank: number }) {
  const photo = slug ? photoFor(slug) : null;
  const drawn = slug ? identityFor(slug).bottle : null;
  const blank = !photo && !drawn;

  return (
    <div
      className={`ob-item ${blank ? "ob-blank" : ""}`}
      data-rank={rank}
      style={{ aspectRatio: photo ? `${photo.width} / ${photo.height}` : "200 / 820" }}
    >
      <div className="ob-tilt">
        <div className="ob-turn">
          {photo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a small, already-optimised WebP; next/image adds nothing here */}
              <img className="ob-art" src={photo.src} width={photo.width} height={photo.height} alt="" decoding="async" />
              <span className="ob-sheen" style={{ "--mask": `url(${photo.src})` } as React.CSSProperties} />
            </>
          ) : (
            <BottleArt spec={drawn ?? BLANK_BOTTLE} idPrefix={`ob-${slug ?? "blank"}`} className="ob-art" />
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

/** The glass #1 pours into. Drawn in the counter's own ink; only the beer and its head are beer-coloured. */
function Glass() {
  const outline = "M12 4 L88 4 L80 132 Q80 137 75 137 L25 137 Q20 137 20 132 Z";
  return (
    <svg viewBox="0 0 100 140" className="ob-glass" focusable="false">
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
            <circle key={cx} className="ob-bubble" cx={cx} cy={92 - index * 14} r="2.2" fill="var(--foam)" style={{ animationDelay: `${3.4 + index * 0.9}s` }} />
          ))}
          <rect className="ob-head" x="0" y="-26" width="100" height="26" fill="var(--foam)" />
        </g>
      </g>
      <path d={outline} className="ob-glass-rim" />
      <path d="M27 16 L31 118" className="ob-glass-shine" />
    </svg>
  );
}
