/** Tier names come from the server; the colors live in profile.css as --tier-*. */
export const TIER_ORDER = ["Digit", "Variable", "Lemma", "Theorem", "Infinity"];
export const TIER_HEX: Record<string, string> = { Digit: "#8aa0ad", Variable: "#2fbf71", Lemma: "#00a8c8", Theorem: "#a06bff", Infinity: "#ffb020" };

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A 5×5 mirrored pattern and color, always the same for the same handle. */
export function identicon(handle: string) {
  const h = hash(handle.toLowerCase());
  const cells: [number, number][] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if ((h >>> ((y * 3 + x) % 30)) & 1) {
      cells.push([x, y]);
      if (x < 2) cells.push([4 - x, y]);
    }
  }
  return { cells, color: `hsl(${h % 360} 70% 58%)`, background: `hsl(${h % 360} 45% 16%)` };
}

export function Avatar({ handle, size = 40, tier }: { handle: string; size?: number; tier?: string | null }) {
  const { cells, color, background } = identicon(handle);
  return (
    <svg className="identicon" width={size} height={size} viewBox="-1 -1 7 7" aria-hidden
      style={{ background, outlineColor: tier ? TIER_HEX[tier] : "transparent" }}>
      {cells.map(([x, y]) => <rect key={x + "-" + y} x={x} y={y} width="1.02" height="1.02" fill={color} />)}
    </svg>
  );
}

export function TierChip({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  return <span className="tier-chip" title={"Sigma tier: " + tier}><i style={{ background: TIER_HEX[tier] }} />{tier}</span>;
}
