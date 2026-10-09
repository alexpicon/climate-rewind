/** The Climate Rewind mark: a C that turns back on itself (rewind) around a radar needle. Flat, one color. */
export function BrandMark({ size = 30, color = "#FFB45A" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M50.39 16.57A24 24 0 1 0 50.39 47.43" fill="none" stroke={color} strokeWidth="5.5" strokeLinecap="round" />
      <path d="M51.06 55.18L50.39 47.43L42.64 48.1" fill="none" stroke={color} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 32V18" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="32" r="4.5" fill={color} />
    </svg>
  );
}
