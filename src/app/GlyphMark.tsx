/**
 * Glyphra brand mark — an ink gem with an inner glyph outline. Monochrome:
 * it inherits `currentColor` (black in light, white in dark) and cuts the
 * inner stroke from the surface behind it. Scales crisply from 14px to hero.
 */
export default function GlyphMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`text-ink ${className ?? ""}`}
    >
      <rect
        x="4.4"
        y="4.4"
        width="15.2"
        height="15.2"
        rx="4.6"
        transform="rotate(45 12 12)"
        fill="currentColor"
      />
      <path
        d="M12 7.6 L16.4 12 L12 16.4 L7.6 12 Z"
        stroke="var(--bg-editor)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
