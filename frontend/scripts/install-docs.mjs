#!/usr/bin/env node
/**
 * Installs the official language documentation that the editor's reference panel shows.
 *
 * The content comes from DevDocs (devdocs.io), which packages each project's own documentation
 * (python.org, cppreference.com, MDN, the OpenJDK javadoc, ...) in one format with a search index.
 * Each bundle is split into small files so a browser only downloads the pages someone opens:
 *
 *   <out>/manifest.json                 every installed doc, its version, credit line and judge languages
 *   <out>/<slug>@<mtime>/index.json      search index: { types: [name], entries: [[name, path, type]] }
 *   <out>/<slug>@<mtime>/p/<n>.json      pages, grouped by a hash of their path: { path: html }
 *
 * Every file also gets a .gz copy, so nginx serves them compressed without spending CPU.
 * Folders carry the bundle's timestamp, so they can be cached forever; rerunning the script only
 * downloads bundles that changed and removes the old folders.
 *
 *   node scripts/install-docs.mjs                       all docs into public/refdocs
 *   node scripts/install-docs.mjs --only python~3.12   just one
 *   node scripts/install-docs.mjs --out /some/dir
 */
import { mkdir, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** DevDocs bundle → judge languages it documents. Versions follow judge/images/*.Dockerfile. */
const DOCS = [
  { slug: "cpp", name: "C++", languages: ["CPP", "CPP20"] },
  { slug: "c", name: "C", languages: ["C"] },
  { slug: "openjdk~17", name: "Java 17", languages: ["JAVA"] },
  { slug: "python~3.12", name: "Python 3.12", languages: ["PYTHON"] },
  { slug: "python~3.10", name: "Python 3.10 (PyPy)", languages: ["PYPY"] },
  { slug: "javascript", name: "JavaScript", languages: ["JAVASCRIPT"] },
  { slug: "node~20_lts", name: "Node.js 20", languages: ["JAVASCRIPT"] },
  { slug: "go", name: "Go", languages: ["GO"] },
  { slug: "rust", name: "Rust", languages: ["RUST"] },
  { slug: "kotlin~1.9", name: "Kotlin 1.9", languages: ["KOTLIN"] },
  { slug: "ruby~3.3", name: "Ruby 3.3", languages: ["RUBY"] },
  { slug: "php", name: "PHP", languages: ["PHP"] },
  { slug: "zig", name: "Zig", languages: ["ZIG"] },
];

const BUCKET_BYTES = 64 * 1024;
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const out = path.resolve(option("--out") ?? path.join(here, "..", "public", "refdocs"));
const only = option("--only")?.split(",");

/** FNV-1a over UTF-16 code units; frontend/src/lib/refdocs.ts computes the same value. */
export function bucketOf(pagePath, buckets) {
  let h = 0x811c9dc5;
  for (let i = 0; i < pagePath.length; i++) { h ^= pagePath.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % buckets;
}

async function download(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "cp-platform-docs-installer" } });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.text();
    } catch (e) {
      if (attempt >= tries) throw new Error(`Could not download ${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function writeBoth(file, text) {
  await writeFile(file, text);
  await writeFile(file + ".gz", gzipSync(text, { level: 9 }));
}

async function install(doc, meta) {
  const dir = `${doc.slug}@${meta.mtime}`;
  const target = path.join(out, dir);
  if (existsSync(path.join(target, "done"))) {
    console.log(`  ${doc.slug}: already installed`);
    return readCount(target);
  }
  const base = `https://documents.devdocs.io/${doc.slug}/`;
  console.log(`  ${doc.slug}: downloading ${(meta.db_size / 1e6).toFixed(1)} MB…`);
  const [indexText, dbText] = await Promise.all([download(base + "index.json?" + meta.mtime), download(base + "db.json?" + meta.mtime)]);
  const index = JSON.parse(indexText), db = JSON.parse(dbText);

  // Written in place, with the "done" marker last: a folder without it is an unfinished install and is
  // redone. (Renaming a finished folder into place fails on Windows while a dev server watches it.)
  const temp = target;
  await rm(temp, { recursive: true, force: true });
  await mkdir(path.join(temp, "p"), { recursive: true });

  // Search index, compacted: type names once, entries as [name, path, typeIndex].
  const types = index.types.map((t) => t.name);
  const typeIndex = new Map(types.map((name, i) => [name, i]));
  const entries = index.entries.map((e) => {
    if (!typeIndex.has(e.type)) { typeIndex.set(e.type, types.length); types.push(e.type); }
    return [e.name, e.path, typeIndex.get(e.type)];
  });
  await writeBoth(path.join(temp, "index.json"), JSON.stringify({ types, entries }));

  // Pages, grouped into ~64 KB files by a hash of their path.
  const pages = Object.entries(db);
  const total = pages.reduce((sum, [, html]) => sum + html.length, 0);
  const buckets = Math.max(1, Math.ceil(total / BUCKET_BYTES));
  const groups = Array.from({ length: buckets }, () => ({}));
  for (const [pagePath, html] of pages) groups[bucketOf(pagePath, buckets)][pagePath] = html;
  for (let n = 0; n < buckets; n++) await writeBoth(path.join(temp, "p", n + ".json"), JSON.stringify(groups[n]));

  await writeFile(path.join(temp, "done"), String(buckets));
  console.log(`  ${doc.slug}: ${pages.length} pages, ${entries.length} index entries`);
  return buckets;
}

async function readCount(target) { return Number(await readFile(path.join(target, "done"), "utf8")); }

async function main() {
  const wanted = DOCS.filter((d) => !only || only.includes(d.slug));
  if (!wanted.length) throw new Error("No doc matches --only " + only);
  console.log(`Installing ${wanted.length} docs into ${out}`);
  await mkdir(out, { recursive: true });
  const catalog = JSON.parse(await download("https://devdocs.io/docs.json"));

  const manifestFile = path.join(out, "manifest.json");
  const previous = existsSync(manifestFile) ? JSON.parse(await readFile(manifestFile, "utf8")).docs : [];
  const installed = new Map(previous.map((d) => [d.slug, d]));
  const failed = [];
  for (const doc of wanted) {
    const meta = catalog.find((c) => c.slug === doc.slug);
    if (!meta) { failed.push(doc.slug + " (not on DevDocs any more)"); continue; }
    try {
      const buckets = await install(doc, meta);
      installed.set(doc.slug, {
        slug: doc.slug, name: doc.name, release: meta.release ?? "", languages: doc.languages,
        dir: `${doc.slug}@${meta.mtime}`, buckets, home: meta.links?.home ?? "", attribution: meta.attribution ?? "",
      });
    } catch (e) { failed.push(`${doc.slug} (${e.message})`); }
  }

  // Keep the configured order; drop docs no longer configured.
  const docs = DOCS.map((d) => installed.get(d.slug)).filter(Boolean);
  await writeBoth(manifestFile, JSON.stringify({ docs }, null, 1));

  // Remove folders of older versions.
  const keep = new Set(docs.map((d) => d.dir));
  for (const name of await readdir(out)) {
    if (name.includes("@") && !keep.has(name)) await rm(path.join(out, name), { recursive: true, force: true });
  }
  if (failed.length) { console.error("Not installed:\n  " + failed.join("\n  ")); process.exitCode = 1; }
  else console.log("Done.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
