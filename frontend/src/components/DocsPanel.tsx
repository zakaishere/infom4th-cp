import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { Section } from "../lib/cheatsheets";
import { loadIndex, loadManifest, loadPage, pageOf, preparePage, searchIndex, type RefDoc, type RefEntry, type RefIndex } from "../lib/refdocs";

type Sheets = typeof import("../lib/cheatsheets");
/** A request from the editor (F1) to look a word up; `n` changes on every press. */
export type DocsLookup = { word: string; n: number };

const store = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* only remembered for this visit */ } },
};
const WIDE = 760;
/** Location of a doc's front page, built from its sections (most bundles have no page of their own for it). */
const HOME = "";

/**
 * Language reference beside the editor: the official documentation of each judge language, served
 * from this site (see lib/refdocs.ts), and the short cheat sheets. It opens over the problem
 * statement, never over the code, and has no way out to the internet, so it is safe in contests.
 */
export function DocsPanel({ language, onClose, lookup }: { language: string; onClose: () => void; lookup?: DocsLookup | null }) {
  const [mode, setMode] = useState(() => (store.get("cp.refdocs.mode") === "sheet" ? "sheet" : "docs"));
  const [width, setWidth] = useState(() => Number(store.get("cp.refdocs.width")) || Math.min(720, Math.round(window.innerWidth * 0.55)));
  const dragging = useRef(false);
  useEffect(() => { if (lookup) setMode("docs"); }, [lookup]);
  useEffect(() => { store.set("cp.refdocs.mode", mode); }, [mode]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const move = (e: PointerEvent) => { if (dragging.current) setWidth(Math.round(Math.min(window.innerWidth - 160, Math.max(320, e.clientX)))); };
    const up = () => { if (dragging.current) { dragging.current = false; document.body.classList.remove("resizing"); } };
    window.addEventListener("keydown", close); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [onClose]);
  useEffect(() => { store.set("cp.refdocs.width", String(width)); }, [width]);
  const shown = Math.min(width, window.innerWidth);

  return createPortal(
    <aside className="docs-panel" role="dialog" aria-label="Language reference" style={{ width: shown }}>
      <div className="docs-top row-between">
        <div className="docs-modes" role="tablist">
          <button role="tab" aria-selected={mode === "docs"} className={mode === "docs" ? "active" : ""} onClick={() => setMode("docs")}>Official docs</button>
          <button role="tab" aria-selected={mode === "sheet"} className={mode === "sheet" ? "active" : ""} onClick={() => setMode("sheet")}>Cheat sheet</button>
        </div>
        <button className="ghost small" onClick={onClose} aria-label="Close reference" title="Close (Esc)">✕</button>
      </div>
      {mode === "docs" ? <OfficialDocs language={language} lookup={lookup} wide={shown >= WIDE} /> : <CheatSheet language={language} />}
      <div className="docs-resize" onPointerDown={(e) => { e.preventDefault(); dragging.current = true; document.body.classList.add("resizing"); }} title="Drag to resize" />
    </aside>,
    document.body,
  );
}

function defaultDoc(docs: RefDoc[], language: string) {
  const saved = store.get("cp.refdocs.doc." + language);
  return docs.find((d) => d.slug === saved) ?? docs.find((d) => d.languages.includes(language)) ?? docs[0];
}

function OfficialDocs({ language, lookup, wide }: { language: string; lookup?: DocsLookup | null; wide: boolean }) {
  const [docs, setDocs] = useState<RefDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [index, setIndex] = useState<RefIndex | null>(null);
  // Visited locations ("page#anchor") for back and forward, per opened doc.
  const [trail, setTrail] = useState<{ stack: string[]; at: number }>({ stack: [], at: -1 });
  const [html, setHtml] = useState<string | null>(null);
  const [pageState, setPageState] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [selected, setSelected] = useState(0);
  const [contents, setContents] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const doc = docs?.find((d) => d.slug === slug) ?? null;
  const location = trail.stack[trail.at] ?? null;

  useEffect(() => {
    loadManifest().then((list) => { setDocs(list); if (!list.length) setError("none"); }).catch(() => setError("none"));
    search.current?.focus();
  }, []);
  // Follow the editor's language unless the open doc already belongs to it.
  useEffect(() => {
    if (!docs?.length) return;
    setSlug((current) => {
      const open = docs.find((d) => d.slug === current);
      return open && open.languages.includes(language) ? current : defaultDoc(docs, language).slug;
    });
  }, [docs, language]);

  useEffect(() => {
    if (!doc) return;
    let live = true;
    setIndex(null);
    setTrail({ stack: [], at: -1 });
    loadIndex(doc).then((loaded) => {
      if (!live) return;
      setIndex(loaded);
      const saved = store.get("cp.refdocs.page." + doc.slug);
      const start = saved && loaded.titleOf.has(pageOf(saved)) ? saved : loaded.titleOf.has("index") ? "index" : HOME;
      setTrail({ stack: [start], at: 0 });
    }).catch(() => { if (live) setPageState("failed"); });
    return () => { live = false; };
  }, [doc]);

  // Load the page; scroll to its anchor once it is on screen.
  const page = location ? pageOf(location) : null;
  useEffect(() => {
    if (!doc || !page) return;
    let live = true;
    setPageState("loading");
    loadPage(doc, page).then((raw) => {
      if (!live) return;
      if (raw == null) { setHtml(null); setPageState("missing"); return; }
      setHtml(preparePage(raw, page));
      setPageState("ready");
    }).catch(() => { if (live) setPageState("failed"); });
    return () => { live = false; };
  }, [doc, page]);
  useEffect(() => {
    if (!body.current || location == null) return;
    if (location === HOME) { body.current.scrollTop = 0; return; }
    if (pageState !== "ready") return;
    let anchor = location.includes("#") ? location.slice(location.indexOf("#") + 1) : "";
    try { anchor = decodeURIComponent(anchor); } catch { /* use it as written */ }
    const target = anchor ? body.current.querySelector(`[id="${CSS.escape(anchor)}"], [name="${CSS.escape(anchor)}"]`) : null;
    if (target) target.scrollIntoView({ block: "start" }); else body.current.scrollTop = 0;
  }, [pageState, location, html]);
  useEffect(() => { if (doc && location != null) store.set("cp.refdocs.page." + doc.slug, location); }, [doc, location]);

  const go = useCallback((to: string) => {
    setShowResults(false);
    setContents(false);
    setTrail((t) => {
      if (t.stack[t.at] === to) return t;
      const stack = [...t.stack.slice(0, t.at + 1), to].slice(-100);
      return { stack, at: stack.length - 1 };
    });
  }, []);
  const back = () => setTrail((t) => ({ ...t, at: Math.max(0, t.at - 1) }));
  const forward = () => setTrail((t) => ({ ...t, at: Math.min(t.stack.length - 1, t.at + 1) }));

  const results = useMemo(() => (index && query.trim() ? searchIndex(index, query) : []), [index, query]);
  useEffect(() => { setSelected(0); }, [query]);

  // F1 in the editor: open the exact match directly, otherwise show the matches.
  useEffect(() => {
    if (!lookup) return;
    setQuery(lookup.word);
    setShowResults(true);
  }, [lookup]);
  const lookupDone = useRef<number | null>(null);
  useEffect(() => {
    if (!lookup || !index || lookupDone.current === lookup.n || query !== lookup.word) return;
    lookupDone.current = lookup.n;
    const word = lookup.word.toLowerCase(), best = results[0];
    if (best && (best.lower === word || best.tail === word)) go(best.path);
  }, [lookup, index, results, query, go]);

  function onSearchKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && (query || showResults)) { e.stopPropagation(); setQuery(""); setShowResults(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setShowResults(true); setSelected((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && results[selected]) { e.preventDefault(); go(results[selected].path); }
  }
  function onBodyClick(e: ReactMouseEvent | ReactKeyboardEvent) {
    if ("key" in e && e.key !== "Enter") return;
    const link = (e.target as HTMLElement).closest<HTMLElement>("[data-to]");
    if (link) { e.preventDefault(); go(link.dataset.to!); }
  }

  if (error) return (
    <div className="docs-body"><div className="notice warn small">The official documentation is not installed on this server yet. An administrator can install it with <code>node scripts/install-docs.mjs</code> in the frontend folder. The cheat sheet still works.</div></div>
  );
  if (!docs || !doc) return <div className="docs-body"><div className="empty">Loading…</div></div>;

  const title = page ? index?.titleOf.get(page) : undefined;
  const home = location === HOME;
  const at = !index ? -2 : home ? -1 : page ? index.pages.indexOf(page) : -2;
  const prev = index && at === 0 ? HOME : index && at > 0 ? index.pages[at - 1] : null;
  const next = index && at >= -1 && at < index.pages.length - 1 ? index.pages[at + 1] : null;
  const nameOf = (p: string) => (p === HOME ? doc.name + " home" : index?.titleOf.get(p)?.name);
  const ownDocs = docs.filter((d) => d.languages.includes(language));
  const otherDocs = docs.filter((d) => !d.languages.includes(language));

  return (
    <>
      <div className="docs-head">
        <div className="row docs-nav">
          <button className="ghost small" onClick={back} disabled={trail.at <= 0} title="Back" aria-label="Back">←</button>
          <button className="ghost small" onClick={forward} disabled={trail.at >= trail.stack.length - 1} title="Forward" aria-label="Forward">→</button>
          {!wide && <button className={"ghost small" + (contents ? " active" : "")} onClick={() => setContents((c) => !c)} aria-expanded={contents}>☰ Contents</button>}
          <select value={doc.slug} onChange={(e) => { setSlug(e.target.value); store.set("cp.refdocs.doc." + language, e.target.value); }} aria-label="Documentation">
            <optgroup label="This language">{ownDocs.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}</optgroup>
            {otherDocs.length > 0 && <optgroup label="Other languages">{otherDocs.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}</optgroup>}
          </select>
        </div>
        <div className="docs-search">
          <input ref={search} type="search" placeholder={`Search ${doc.name}…  (F1 in the editor looks up the word under the cursor)`} value={query}
            onChange={(e) => { setQuery(e.target.value); setShowResults(true); }} onFocus={() => query && setShowResults(true)} onKeyDown={onSearchKey}
            aria-label={"Search " + doc.name} aria-controls="ref-results" />
          {showResults && query.trim() && (
            <ul id="ref-results" className="ref-results" role="listbox">
              {!index && <li className="muted small">Loading the index…</li>}
              {index && results.length === 0 && <li className="muted small">Nothing matches “{query}”.</li>}
              {results.map((r, i) => (
                <li key={r.path + i} role="option" aria-selected={i === selected} className={i === selected ? "active" : ""}
                  onMouseDown={(e) => { e.preventDefault(); go(r.path); }} onMouseEnter={() => setSelected(i)}>
                  <span className="mono">{r.name}</span><span className="small muted">{index!.types[r.type]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className={"ref-layout" + (wide ? " wide" : "")}>
        {(wide || contents) && index && <Contents index={index} current={page} onOpen={go} />}
        {!(contents && !wide) && (
          <div className="docs-body ref-body" ref={body}>
            {index && title && !home && (
              <nav className="ref-crumbs small" aria-label="Breadcrumb">
                <a data-to="" onClick={() => go(HOME)}>{doc.name}</a> › <span>{index.types[title.type]}</span> › <strong>{title.name}</strong>
              </nav>
            )}
            {!index && pageState !== "failed" && <div className="empty">Loading…</div>}
            {home && index && <Home doc={doc} index={index} onOpen={go} />}
            {!home && pageState === "loading" && <div className="empty">Loading…</div>}
            {pageState === "failed" && <div className="notice bad small">This page could not load. Check your connection and try again.</div>}
            {!home && pageState === "missing" && <div className="notice warn small">This page is not part of the installed documentation.</div>}
            {!home && pageState === "ready" && html != null && (
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <article className="ref-page" onClick={onBodyClick} onKeyDown={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
            )}
            {index && (prev != null || next != null) && (
              <div className="ref-pager">
                {prev != null ? <button className="ghost" onClick={() => go(prev)}><span className="small muted">‹ Previous</span><br />{nameOf(prev)}</button> : <span />}
                {next != null ? <button className="ghost" onClick={() => go(next)}><span className="small muted">Next ›</span><br />{nameOf(next)}</button> : <span />}
              </div>
            )}
            <footer className="ref-credit small muted">
              {doc.name}{doc.release ? " " + doc.release : ""} · <span dangerouslySetInnerHTML={{ __html: preparePage(doc.attribution, "") }} /> · Packaged by DevDocs.
            </footer>
          </div>
        )}
      </div>
    </>
  );
}

/** Front page, like docs.python.org's: every section of the doc, opening at its first page. */
function Home({ doc, index, onOpen }: { doc: RefDoc; index: RefIndex; onOpen: (path: string) => void }) {
  const sections = useMemo(() => {
    const first = new Map<number, { page: string; count: number }>();
    for (const page of index.pages) {
      const type = index.titleOf.get(page)!.type;
      const seen = first.get(type);
      if (seen) seen.count++; else first.set(type, { page, count: 1 });
    }
    return index.types.map((name, i) => ({ name, ...first.get(i) })).filter((s): s is { name: string; page: string; count: number } => Boolean(s.page));
  }, [index]);
  return (
    <div className="ref-page ref-home">
      <h1>{doc.name} documentation</h1>
      <p className="muted">{doc.release ? `Version ${doc.release}. ` : ""}Search above, or open a section. F1 in the editor looks up the word under the cursor.</p>
      <div className="ref-sections">
        {sections.map((s) => (
          <button key={s.name} onClick={() => onOpen(s.page)}>
            <strong>{s.name}</strong><span className="small muted">{s.count} page{s.count === 1 ? "" : "s"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Python-style contents: the doc's sections, each opening to its pages. */
function Contents({ index, current, onOpen }: { index: RefIndex; current: string | null; onOpen: (path: string) => void }) {
  const currentType = current ? index.titleOf.get(current)?.type : undefined;
  const [open, setOpen] = useState<number | null>(currentType ?? null);
  useEffect(() => { if (currentType != null) setOpen(currentType); }, [currentType]);
  const byType = useMemo(() => {
    const lists = index.types.map(() => [] as RefEntry[]);
    for (const entry of index.entries) lists[entry.type]?.push(entry);
    return lists;
  }, [index]);
  const LIMIT = 400;
  return (
    <nav className="ref-contents" aria-label="Contents">
      {index.types.map((type, i) => (
        <div key={type + i}>
          <button className={"ref-type" + (open === i ? " open" : "")} onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span>{type}</span><span className="muted small">{byType[i].length}</span>
          </button>
          {open === i && (
            <ul>
              {byType[i].slice(0, LIMIT).map((entry, k) => (
                <li key={entry.path + k}>
                  <button className={pageOf(entry.path) === current && !entry.path.includes("#") ? "current" : ""} onClick={() => onOpen(entry.path)}>{entry.name}</button>
                </li>
              ))}
              {byType[i].length > LIMIT && <li className="small muted">{byType[i].length - LIMIT} more: use the search box.</li>}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}

function CheatSheet({ language }: { language: string }) {
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

  return (
    <>
      <div className="docs-head">
        <div className="filters" role="tablist">
          {sheets && Object.entries(sheets.SHEETS).map(([key, sheet]) => (
            <button key={key} role="tab" aria-selected={key === current} className={key === current ? "active" : ""} onClick={() => setTab(key)}>{sheet.name}</button>
          ))}
        </div>
        <input ref={search} type="search" placeholder="Search: sort, map, read line…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the cheat sheet" />
      </div>
      <div className="docs-body">
        {failed && <div className="notice bad small">The cheat sheet could not load. Check your connection and open it again.</div>}
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
    </>
  );
}
