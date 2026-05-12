#!/usr/bin/env node
// Walks docs/**/*.md + README.md and verifies every relative link, image, and
// intra-doc anchor resolves. Exits non-zero on the first round of failures so
// CI surfaces them.

import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [join(repoRoot, "README.md"), ...walkMarkdown(join(repoRoot, "docs"))];

const failures = [];
const headingCache = new Map();

for (const file of targets) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  let inFence = false;

  lines.forEach((line, idx) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;

    for (const m of line.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)) {
      const isImage = m[1] === "!";
      const raw = m[3].trim().split(/\s+/)[0];
      if (!raw || /^(https?:|mailto:|tel:|#$)/i.test(raw)) {
        if (raw.startsWith("#")) checkAnchor(file, raw.slice(1), file, idx + 1);
        continue;
      }
      const [pathPart, anchor] = raw.split("#");
      const targetPath = pathPart ? resolve(dirname(file), pathPart) : file;
      if (!exists(targetPath)) {
        failures.push({ file, line: idx + 1, target: raw, reason: "missing file" });
        continue;
      }
      if (isImage) continue;
      if (anchor) checkAnchor(file, anchor, targetPath, idx + 1);
    }
  });
}

if (failures.length) {
  const byFile = new Map();
  for (const f of failures) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, fs] of byFile) {
    console.error(`\n${relative(repoRoot, file)}`);
    for (const f of fs) console.error(`  L${f.line}  ${f.target}  → ${f.reason}`);
  }
  console.error(`\n${failures.length} broken link(s).`);
  process.exit(1);
}

console.log(`docs:check — ${targets.length} files, all links resolved.`);

function walkMarkdown(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkMarkdown(p));
    else if (ent.isFile() && ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, (s) => s.replace(/`/g, ""))
    .replace(/[^\p{Letter}\p{Number}\s\-_]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function headingsOf(file) {
  if (headingCache.has(file)) return headingCache.get(file);
  const slugs = new Set();
  const counts = new Map();
  const src = readFileSync(file, "utf8");
  let inFence = false;
  for (const line of src.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const base = slugify(h[2]);
      if (!base) continue;
      const n = counts.get(base) ?? 0;
      slugs.add(n === 0 ? base : `${base}-${n}`);
      counts.set(base, n + 1);
    }
    for (const m of line.matchAll(/<a\s+[^>]*?(?:id|name)=["']([^"']+)["']/gi)) {
      slugs.add(m[1].toLowerCase());
    }
  }
  headingCache.set(file, slugs);
  return slugs;
}

function checkAnchor(sourceFile, anchor, targetFile, lineNo) {
  const slugs = headingsOf(targetFile);
  if (!slugs.has(anchor.toLowerCase())) {
    failures.push({
      file: sourceFile,
      line: lineNo,
      target: `${relative(dirname(sourceFile), targetFile)}#${anchor}`,
      reason: "anchor not found",
    });
  }
}
