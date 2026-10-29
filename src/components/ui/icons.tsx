import type { SVGProps } from "react";

/**
 * The icon set: drawn on a 24px grid with one 1.75px stroke and round caps, so they
 * read as one family. No emoji anywhere in the interface (DESIGN.md).
 *
 * Decorative by default (aria-hidden); pass `title` when an icon stands alone.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { title?: string; size?: number };

/**
 * The stroke (fill none, currentColor, 1.75, round caps) is the class `.ico`, not
 * eight attributes on every icon. One chain page draws 157 of them, and the
 * attributes were 108 bytes each — repeated in the markup AND again in the RSC
 * payload the phone parses, for a drawing that never varies.
 *
 * Note that this makes the stroke a CSS declaration, which OUTRANKS an SVG
 * presentation attribute: an icon that wants to be filled instead of stroked
 * cannot say so with `fill="currentColor"` any more, because `.ico` would win and
 * the icon would vanish. `solid` is that icon's way to ask (see GripIcon).
 */
function Icon({ title, size = 22, solid = false, className, children, ...rest }: IconProps & { solid?: boolean; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={[solid ? "ico ico-solid" : "ico", className].filter(Boolean).join(" ")}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** A map pin: where a person is, and where a branch is. */
export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Icon>
);

export const TagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12.4V4.5a1 1 0 0 1 1-1h7.9l8.1 8.1a1.4 1.4 0 0 1 0 2l-6.9 6.9a1.4 1.4 0 0 1-2 0L3.5 12.4Z" />
    <circle cx="8" cy="8" r="1.3" />
  </Icon>
);
export const GlassIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5h12l-1.4 16.3a1.4 1.4 0 0 1-1.4 1.2H8.8a1.4 1.4 0 0 1-1.4-1.2L6 3.5Z" />
    <path d="M6.6 9h10.8" />
  </Icon>
);
export const StoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9.5 5.6 4h12.8L20 9.5" />
    <path d="M4 9.5c0 1.4 1.1 2.5 2.5 2.5S9 10.9 9 9.5c0 1.4 1.1 2.5 3 2.5s3-1.1 3-2.5c0 1.4 1.1 2.5 2.5 2.5S20 10.9 20 9.5" />
    <path d="M5.5 12v8h13v-8" />
    <path d="M10 20v-4.5h4V20" />
  </Icon>
);
export const MeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20.5c.6-3.6 3.6-5.6 7.5-5.6s6.9 2 7.5 5.6" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Icon>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Icon>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />
  </Icon>
);
export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 2H4.4L6 16.5Z" />
    <path d="M10 21h4" />
  </Icon>
);
export const BellOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 16.5V11a6 6 0 0 1 .8-3M9.2 4.9A6 6 0 0 1 18 11v5.5l1.6 2H8" />
    <path d="M10 21h4M4 4l16 16" />
  </Icon>
);
/** A bookmark: a saved deal. Filled once it is saved. */
export const BookmarkIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p} solid={filled}>
    <path d="M7 3.75h10v16.5l-5-3.75-5 3.75z" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const ArrowDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);
export const GripIcon = (p: IconProps) => (
  <Icon {...p} solid>
    {[8, 12, 16].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.35" />))}
  </Icon>
);
export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" strokeWidth={2.4} />
  </Icon>
);
export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);
export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4.5H15" />
  </Icon>
);
export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
);
export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  </Icon>
);
export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />
  </Icon>
);
export const DeviceIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2" />
    <path d="M11 18.5h2" />
  </Icon>
);
export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2l1.3-2h6.4l1.3 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
    <circle cx="12" cy="13" r="3.4" />
  </Icon>
);
export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.8 21 19.5H3L12 3.8Z" />
    <path d="M12 10v4.2M12 16.9v.1" />
  </Icon>
);
export const InstallIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 16v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V16" />
  </Icon>
);
export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6L4.5 10.8 10.2 9 12 3.5Z" />
  </Icon>
);
export const BarcodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5v14M7.5 5v14M11 5v14M15 5v14M18 5v14M20.5 5v14" />
  </Icon>
);
