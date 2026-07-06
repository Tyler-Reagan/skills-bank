---
title: Skills Bank
description: One registry. Every AI agent on your machine.
sidebar: false
---

<!-- Homepage theme/brand direction for issue #129 — see docs/adr/ADR-0016-docs-site-cosmetic-makeover.md. -->

<script setup>
const hero = {
  text: 'One registry. Every AI agent.',
  tagline: 'Install a skill once — Skills Bank symlinks it into Claude Code, Cursor, Gemini, Copilot, Continue, Cline, and Codex simultaneously. No copies, no drift.',
}

const agents = ['Claude Code', 'Cursor', 'Gemini', 'Copilot', 'Continue', 'Cline', 'Codex']

const features = [
  { title: 'One install, every agent', details: 'A single symlink-based registry keeps Claude Code, Cursor, Gemini, and four more agents in sync. Install once, done.' },
  { title: 'Browse a curated registry', details: 'Skills are organized by function-oriented category (code review, diagnostics, planning, and more) in collapsible sections. Tag filters, full-text search, and an Installed-only toggle let you narrow further. No GitHub account required.' },
  { title: 'Bring your own repo', details: 'Link any GitHub repo you own as your registry source. Refresh pulls the latest with a diff-before-apply preview.' },
  { title: 'Push your registry anywhere', details: "Export a manifest of your registry's origin pointers and push it directly to your linked GitHub repo — or pull it on another machine. One click, no file management." },
  { title: "Heal, don't delete", details: 'Explicit recovery flows for every bad state — install collisions, broken links, and missing files — with your choice at each step.' },
]
</script>

<div class="proto-page">

  <section class="proto-hero">
    <div class="proto-inner">
      <div class="proto-copy">
        <p class="proto-kicker">/skills-bank</p>
        <h1 class="proto-h1">{{ hero.text }}</h1>
        <p class="proto-tagline">{{ hero.tagline }}</p>
        <div class="proto-actions">
          <a class="proto-cmd proto-cmd-primary" href="/getting-started">$ get-started</a>
          <a class="proto-cmd" href="https://github.com/Tyler-Reagan/skills-bank/releases">$ download</a>
        </div>
      </div>
      <div class="proto-ledger" aria-hidden="true">
        <div class="proto-ledger-titlebar">
          <span class="proto-ledger-path">$ skills-bank status --agents</span>
        </div>
        <ul class="proto-ledger-rows">
          <li v-for="a in agents" :key="a"><span>{{ a }}</span><span class="proto-tick">synced ✓</span></li>
        </ul>
      </div>
    </div>
  </section>

  <section class="proto-features">
    <div class="proto-inner">
      <div class="proto-row" v-for="f in features" :key="f.title">
        <span class="proto-row-prompt">&gt;</span>
        <h3 class="proto-row-title">{{ f.title }}</h3>
        <p class="proto-row-details">{{ f.details }}</p>
      </div>
    </div>
  </section>

</div>

<style>
/* Fonts now load globally via .vitepress/theme/custom.css, plus Onest
   here for body copy specifically. */
@import url('https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600&display=swap');

.proto-page :where(h1, h2, h3, p, ul, li) {
  margin: 0;
  padding: 0;
  list-style: none;
}
/* break out of VitePress's centered .vp-doc container for full-bleed sections */
.proto-page {
  position: relative;
  left: 50%;
  width: 100vw;
  margin-left: -50vw;
}

/* ── Palette — reads entirely off the shared vars in
   .vitepress/theme/custom.css (same ones Nav/Sidebar/Footer use), so
   this page follows the light/dark toggle instead of being permanently
   dark. Green is rationed to two functional spots: the primary CTA and
   the "synced" status tick — everything else is neutral gray. ── */
.proto-hero,
.proto-features {
  font-family: 'Archivo', sans-serif;
}
.proto-hero {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}
.proto-features {
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
}
.proto-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 32px;
}
.proto-hero .proto-inner {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 48px;
  align-items: center;
  padding-top: 88px;
  padding-bottom: 88px;
}
/* ── .proto-copy is the hero's main content (headline/tagline/CTAs),
   not a supporting element like the ledger panel beside it — sized up
   accordingly so it reads as the page's lead, not a peer to the chrome
   text we just tuned. ── */
.proto-kicker {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-3);
  margin-bottom: 20px;
}
.proto-h1 {
  font-size: clamp(2.75rem, 5vw, 4.5rem);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.02em;
  text-wrap: balance;
  margin-bottom: 22px;
}
.proto-tagline {
  font-family: 'Onest', sans-serif;
  font-size: 21px;
  font-weight: 500;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  max-width: 46ch;
  margin-bottom: 34px;
}
.proto-actions {
  display: flex;
  gap: 12px;
}

/* Command-styled CTAs. Primary uses the brand accent as text on a
   neutral chip — the one deliberate "this is the main action" signal,
   not a colored background. */
.proto-cmd {
  display: inline-flex;
  align-items: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px;
  font-weight: 600;
  padding: 12px 20px;
  border-radius: 6px;
  text-decoration: none;
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-1);
}
.proto-cmd-primary {
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-border);
}

/* Terminal-titlebar on the ledger panel (contained, not applied to
   the whole page) — a plain mono label, no decorative colored dots. */
.proto-ledger {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  overflow: hidden;
}
.proto-ledger-titlebar {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: var(--vp-c-bg-alt);
  border-bottom: 1px solid var(--vp-c-divider);
}
.proto-ledger-path {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.proto-ledger-rows {
  padding: 8px 18px 14px;
}
.proto-ledger-rows li {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--vp-c-divider);
  font-family: 'Onest', sans-serif;
  font-size: 14px;
}
.proto-ledger-rows li:last-child {
  border-bottom: none;
}
.proto-tick {
  color: var(--vp-c-brand-1);
}

.proto-features .proto-inner {
  padding-top: 56px;
  padding-bottom: 88px;
}

/* `>` prompt in place of a plain numeric index — neutral gray, not
   green; it's decorative framing, not a status signal. */
.proto-row {
  display: grid;
  grid-template-columns: 32px 260px 1fr;
  gap: 24px;
  padding: 22px 0;
  border-top: 1px solid var(--vp-c-divider);
}
.proto-row-prompt {
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px;
  color: var(--vp-c-text-3);
  padding-top: 2px;
}
.proto-row-title {
  font-size: 18px;
  font-weight: 800;
}
.proto-row-details {
  font-family: 'Onest', sans-serif;
  font-size: 17px;
  font-weight: 500;
  line-height: 1.65;
  color: var(--vp-c-text-2);
  max-width: 60ch;
}

@media (max-width: 720px) {
  .proto-hero .proto-inner {
    grid-template-columns: 1fr;
    padding-top: 56px;
    padding-bottom: 56px;
  }
  .proto-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}

</style>
