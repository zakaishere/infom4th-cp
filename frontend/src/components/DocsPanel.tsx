import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Section } from "../lib/cheatsheets";

type Sheets = typeof import("../lib/cheatsheets");

/**
 * Searchable syntax reference. The sheets are a static file fetched once and searched in the browser,
 * so using it adds nothing to the judges or the API. It has no outside links, so reading it never
 * leaves full screen during a contest.
 */
export function DocsPanel({ language, onClose }: { language: string; onClose: () => void }) {
  const [sheets, setSheets] = useState<Sheets | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let open = true;
    import("../lib/cheatsheets").then((loaded) => { if (open) setSheets(loaded); }).catch(() => { if (open) setFailed(true); });
    return () => { open = false; };
  }, []);
  useEffect(() => { search.current?.focus(); }, []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const suggested = sheets?.SHEET_OF[language];
  const current = tab ?? suggested ?? "cpp";
  const sections = useMemo<Section[]>(() => {
    const sheet = sheets?.SHEETS[current];
    if (!sheet) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return sheet.sections;
    return sheet.sections.map((section) => ({
      title: section.title,
      entries: section.entries.filter((entry) => {
        const text = (section.title + " " + entry.title + " " + entry.code + " " + (entry.note ?? "")).toLowerCase();
        return words.every((word) => text.includes(word));
      }),
    })).filter((section) => section.entries.length > 0);
  }, [sheets, current, query]);

  function copy(key: string, code: string) {
    // Clipboard access needs HTTPS; on plain HTTP the code can still be selected by hand.
    navigator.clipboard?.writeText(code).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1200); }).catch(() => undefined);
  }

  return createPortal(
    <aside className="docs-panel" role="dialog" aria-label="Language reference">
      <div className="docs-head">
        <div className="row-between">
          <strong>Reference</strong>
          <button className="ghost small" onClick={onClose} aria-label="Close reference">✕</button>
        </div>
        <div className="filters" role="tablist">
          {sheets && Object.entries(sheets.SHEETS).map(([key, sheet]) => (
            <button key={key} role="tab" aria-selected={key === current} className={key === current ? "active" : ""} onClick={() => setTab(key)}>{sheet.name}</button>
          ))}
        </div>
        <input ref={search} type="search" placeholder="Search: sort, map, read line…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the reference" />
      </div>
      <div className="docs-body">
        {failed && <div className="notice bad small">The reference could not load. Check your connection and open it again.</div>}
        {sheets && !suggested && tab === null && <div className="notice small">There is no sheet for this language yet, so here is another one.</div>}
        {sheets && sections.length === 0 && <div className="empty">Nothing matches “{query}”.</div>}
        {sections.map((section) => (
          <section key={section.title}>
            <h4>{section.title}</h4>
            {section.entries.map((entry) => {
              const key = section.title + entry.title;
              return (
                <div key={key} className="docs-entry">
                  <div className="row-between">
                    <span className="small"><strong>{entry.title}</strong></span>
                    {navigator.clipboard && <button className="ghost small" onClick={() => copy(key, entry.code)}>{copied === key ? "Copied" : "Copy"}</button>}
                  </div>
                  <pre className="mono">{entry.code}</pre>
                  {entry.note && <div className="small muted">{entry.note}</div>}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </aside>,
    document.body,
  );
}
