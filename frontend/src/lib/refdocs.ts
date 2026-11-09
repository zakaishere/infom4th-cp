/**
 * Official language documentation, installed on this server by frontend/scripts/install-docs.mjs.
 * Everything is static files: the browser downloads a doc's search index once, then only the small
 * page groups it opens, and caches them. Searching runs here, so the server does no work.
 */
export type RefDoc = {
  slug: string; name: string; release: string; languages: string[];
  dir: string; buckets: number; home: string; attribution: string;
};
export type RefEntry = { name: string; path: string; type: number; lower: string; tail: string };
export type RefIndex = {
  types: string[];
  entries: RefEntry[];
  /** Page paths (without #anchor) in reading order: grouped by type, as the doc lists them. */
  pages: string[];
  /** First index entry that points at each page, for titles and breadcrumbs. */
  titleOf: Map<string, RefEntry>;
};

const ROOT = import.meta.env.BASE_URL + "refdocs/";

/** Same hash as the install script, so both agree on which file holds a page. */
function bucketOf(pagePath: string, buckets: number) {
  let h = 0x811c9dc5;
  for (let i = 0; i < pagePath.length; i++) { h ^= pagePath.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % buckets;
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status === 404 ? "not installed" : "HTTP " + response.status);
  return response.json() as Promise<T>;
}

let manifest: Promise<RefDoc[]> | null = null;
export function loadManifest() {
  manifest ??= json<{ docs: RefDoc[] }>(ROOT + "manifest.json").then((m) => m.docs)
    .catch((e) => { manifest = null; throw e; });
  return manifest;
}

const indexes = new Map<string, Promise<RefIndex>>();
export function loadIndex(doc: RefDoc) {
  let found = indexes.get(doc.dir);
  if (!found) {
    found = json<{ types: string[]; entries: [string, string, number][] }>(ROOT + doc.dir + "/index.json").then((raw) => {
      const entries = raw.entries.map(([name, path, type]) => {
        // "sorted()" and "std::vector::push_back()" should match "sorted" and "push_back" exactly.
        const lower = name.toLowerCase().replace(/\s*\(\)$/, "");
        return { name, path, type, lower, tail: lower.split(/::|\.|#|: |\s|->/).filter(Boolean).pop() ?? lower };
      });
      const titleOf = new Map<string, RefEntry>();
      const byType = raw.types.map(() => [] as string[]);
      for (const entry of entries) {
        const page = pageOf(entry.path);
        if (!titleOf.has(page)) { titleOf.set(page, entry); byType[entry.type]?.push(page); }
        // An entry without an anchor names the page itself; prefer it as the title.
        else if (!entry.path.includes("#") && titleOf.get(page)!.path.includes("#")) titleOf.set(page, entry);
      }
      return { types: raw.types, entries, pages: byType.flat(), titleOf };
    });
    found.catch(() => indexes.delete(doc.dir));
    indexes.set(doc.dir, found);
  }
  return found;
}

const groups = new Map<string, Promise<Record<string, string>>>();
export async function loadPage(doc: RefDoc, page: string): Promise<string | null> {
  const url = ROOT + doc.dir + "/p/" + bucketOf(page, doc.buckets) + ".json";
  let group = groups.get(url);
  if (!group) {
    group = json<Record<string, string>>(url);
    group.catch(() => groups.delete(url));
    groups.set(url, group);
  }
  return (await group)[page] ?? null;
}

export const pageOf = (path: string) => path.split("#")[0];

/** Best matches first: exact name, then a name or its last part starting with the query, then the rest. */
export function searchIndex(index: RefIndex, query: string, limit = 80): RefEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored: { entry: RefEntry; score: number }[] = [];
  for (const entry of index.entries) {
    if (!words.every((w) => entry.lower.includes(w))) continue;
    let score = entry.lower === q ? 1 : entry.tail === q ? 2 : entry.lower.startsWith(q) ? 3 : entry.tail.startsWith(q) ? 4 : 5;
    // An exact match in the typed case comes first, so "Vec" finds the type before the module "vec".
    if (score <= 2 && entry.name.replace(/\s*\(\)$/, "").endsWith(query.trim())) score = 0;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.name.length - b.entry.name.length);
  return scored.slice(0, limit).map((s) => s.entry);
}

/**
 * Makes a stored page safe to show here: no scripts, styles or event handlers; links inside the doc
 * become in-panel links (data-to), and links or images that would reach the internet are switched off,
 * so the reference works offline and never leaves the contest page.
 */
export function preparePage(html: string, page: string): string {
  const parsed = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const root = parsed.body.firstElementChild as HTMLElement;
  root.querySelectorAll("script, style, link, meta, base, iframe, frame, object, embed, form, input, button, textarea, select, svg foreignObject").forEach((n) => n.remove());
  root.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "srcset" || name === "formaction" || (name === "xlink:href")) el.removeAttribute(attr.name);
    }
  });
  root.querySelectorAll("img").forEach((img) => {
    if (!(img.getAttribute("src") ?? "").startsWith("data:image/")) img.replaceWith(parsed.createTextNode(img.getAttribute("alt") ?? ""));
  });
  root.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href");
    a.removeAttribute("href");
    a.removeAttribute("target");
    if (!href) return;
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) {
      a.classList.add("ref-external");
      a.setAttribute("title", "Outside link (switched off)");
      return;
    }
    a.setAttribute("data-to", href.startsWith("#") ? page + href : resolve(page, href));
    a.setAttribute("tabindex", "0");
    a.setAttribute("role", "link");
  });
  return root.innerHTML;
}

/** Resolves a relative link against the current page path, like a browser would. */
function resolve(page: string, href: string) {
  const url = new URL(href, "https://doc.invalid/" + page);
  return decodeURIComponent(url.pathname.slice(1)) + url.hash;
}
