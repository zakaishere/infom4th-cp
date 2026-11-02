import { ApiError, post } from "../api";

/**
 * Tells the jury when a contestant leaves the contest screen. Reports wait in this browser and retry,
 * so a dropped connection never loses them or makes the time away look wrong.
 */
export type FullscreenKind = "LEFT_FULLSCREEN" | "LOST_FOCUS" | "FULLSCREEN_REFUSED";
export type FullscreenReason = "EXITED" | "PAGE_RELOAD" | "EXIT_BUTTON" | "OTHER_WINDOW" | "BROWSER_REFUSED";
type Report = { id: string; action: "left" | "returned"; kind: FullscreenKind; reason: FullscreenReason; at: number };

const RETRY_MS = 5000;
const key = (run: string) => "cp.fullscreen.queue." + run;
const sending = new Set<string>();

function read(run: string): Report[] {
  try { return JSON.parse(localStorage.getItem(key(run)) ?? "[]") as Report[]; } catch { return []; }
}
function write(run: string, reports: Report[]) {
  try { localStorage.setItem(key(run), JSON.stringify(reports)); } catch { /* the next report still goes out */ }
}

/** Sends waiting reports in order: a return must arrive after the exit it belongs to. */
export async function sendFullscreenReports(run: string) {
  if (sending.has(run)) return;
  sending.add(run);
  try {
    for (let reports = read(run); reports.length; reports = read(run)) {
      const { at, ...report } = reports[0];
      try {
        await post("/api/runs/" + run + "/fullscreen-events", { ...report, agoMs: Math.max(0, Math.round(Date.now() - at)) });
      } catch (e) {
        // The server refused it, so retrying can't help. Anything else is the network: try again soon.
        if (!(e instanceof ApiError) || e.status === 0 || e.status === 429 || e.status >= 500) {
          setTimeout(() => void sendFullscreenReports(run), RETRY_MS);
          return;
        }
      }
      write(run, read(run).slice(1));
    }
  } finally {
    sending.delete(run);
  }
}

export function reportFullscreen(run: string, id: string, action: Report["action"], kind: FullscreenKind, reason: FullscreenReason = "EXITED") {
  write(run, [...read(run), { id, action, kind, reason, at: Date.now() }]);
  void sendFullscreenReports(run);
}

/** Remembers a contestant was in full screen, so a page reload can't quietly reset it. */
const enteredKey = (run: string) => "cp.fullscreen.entered." + run;
export function markFullscreenEntered(run: string) {
  try { localStorage.setItem(enteredKey(run), "1"); } catch { /* ignore */ }
}
export function wasFullscreenEntered(run: string) {
  try { return localStorage.getItem(enteredKey(run)) === "1"; } catch { return false; }
}
