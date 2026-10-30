import { TIER_HEX, identicon } from "../components/Avatar";

export type Card = {
  handle: string; name: string; tier?: string | null; sigma?: number | null; rank?: number | null; players: number;
  rating?: number | null; solved: number; gold: number; silver: number; bronze: number;
};

/** Draws the card in the browser, so sharing a profile needs no server work and no public page. */
export function drawCard(canvas: HTMLCanvasElement, c: Card) {
  const W = 1200, H = 630, ctx = canvas.getContext("2d")!;
  canvas.width = W; canvas.height = H;
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  const background = ctx.createLinearGradient(0, 0, W, H);
  background.addColorStop(0, "#072b3b"); background.addColorStop(0.6, "#0b5a6d"); background.addColorStop(1, "#00a8c8");
  ctx.fillStyle = background; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(53,199,232,0.18)"; ctx.font = `700 460px ${font}`; ctx.textAlign = "right"; ctx.fillText("Σ", W - 40, H - 90);
  ctx.textAlign = "left";

  const { cells, color, background: tile } = identicon(c.handle);
  const X = 70, Y = 70, S = 170, unit = S / 7;
  ctx.fillStyle = tile; ctx.fillRect(X, Y, S, S);
  ctx.fillStyle = color;
  for (const [x, y] of cells) ctx.fillRect(X + (x + 1) * unit, Y + (y + 1) * unit, unit + 0.5, unit + 0.5);
  if (c.tier) { ctx.strokeStyle = TIER_HEX[c.tier]; ctx.lineWidth = 8; ctx.strokeRect(X - 4, Y - 4, S + 8, S + 8); }

  ctx.fillStyle = "#fff"; ctx.font = `700 60px ${font}`;
  ctx.fillText(fit(ctx, c.name, 880), 280, 130);
  ctx.fillStyle = "#cfeaf1"; ctx.font = `400 34px ${font}`;
  ctx.fillText("@" + c.handle + (c.tier ? "  ·  " + c.tier : ""), 280, 185);

  const stats: [string, string][] = [
    ["SIGMA", c.sigma != null ? "Σ " + c.sigma.toLocaleString() : "–"],
    ["RANK", c.rank != null ? `#${c.rank} of ${c.players}` : "–"],
    ["RATING", c.rating != null ? String(c.rating) : "–"],
    ["SOLVED", String(c.solved)],
  ];
  stats.forEach(([label, value], i) => {
    const x = 70 + i * 275;
    ctx.fillStyle = "#9fd8e6"; ctx.font = `600 24px ${font}`; ctx.fillText(label, x, 340);
    ctx.fillStyle = "#fff"; ctx.font = `700 46px ${font}`; ctx.fillText(fit(ctx, value, 255), x, 395);
  });
  ([["#ffc83d", c.gold], ["#c9d3da", c.silver], ["#d0894f", c.bronze]] as [string, number][]).forEach(([medal, count], i) => {
    const x = 90 + i * 130;
    ctx.fillStyle = medal; ctx.beginPath(); ctx.arc(x, 470, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `700 34px ${font}`; ctx.fillText(String(count), x + 32, 482);
  });
  ctx.fillStyle = "#fff"; ctx.font = `700 34px ${font}`; ctx.fillText("INFOM4TH ARENA", 70, 580);
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > width) cut = cut.slice(0, -1);
  return cut + "…";
}
