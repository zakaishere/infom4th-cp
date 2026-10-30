import { post } from "../api";

// Measures what the contestant experiences, from the click until the verdict is on screen.
// performance.now() is unaffected by the laptop's clock. Reports are best effort: they must
// never disturb submitting, so failures are ignored.
const open = new Map<string, { clicked: number; acceptedMs: number }>();

/** Call right after the server accepted a submission, with the performance.now() of the click. */
export function submissionAccepted(id: string, clicked: number) {
  const acceptedMs = Math.round(performance.now() - clicked);
  open.set(id, { clicked, acceptedMs });
  post("/api/submissions/" + id + "/timing", { acceptedMs }).catch(() => undefined);
}

/** Call when the verdict is shown. Only the first call for a submission reports anything. */
export function verdictShown(id: string) {
  const timing = open.get(id);
  if (!timing) return;
  open.delete(id);
  post("/api/submissions/" + id + "/timing", { acceptedMs: timing.acceptedMs, verdictMs: Math.round(performance.now() - timing.clicked) }).catch(() => undefined);
}
