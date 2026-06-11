# Skill labels

Skills Bank organizes your registry by **category** and **tags**. Labels are user-assigned — nothing is set automatically. Skills with no labels appear under **Uncategorized** in the Registry tab until you assign them.

The **Auto-Generate** tool (inside Manage Labels) can suggest a category and tags for any skill based on its name and description, but suggestions are always reviewed and confirmed before anything is saved.

Labels are stored in `labels.json` in your app data directory and never touch the skill files themselves. They persist across registry syncs and manifest imports.

## Browse navigation

Skills are grouped into collapsible category sections when categories have been assigned. When two or more sections are visible, a **Collapse all / Expand all** toggle appears in the results row — click it to fold or unfold every section at once. Individual sections can still be toggled independently. Skills with no category assigned appear together under **Uncategorized**.

## Categories

Each skill has at most one category. Skills with no category assigned appear under **Uncategorized** in the Registry tab.

| Category         | Description                                                                            |
| ---------------- | -------------------------------------------------------------------------------------- |
| `frontend`       | UI frameworks, CSS, component libraries, and browser-rendering concerns                |
| `backend`        | Server runtimes, databases, auth, APIs, queues, and ORM tooling                        |
| `infrastructure` | Cloud providers, container orchestration, CI/CD, IaC, and observability                |
| `testing`        | Unit, integration, and end-to-end test frameworks, TDD workflows, and coverage tooling |
| `writing`        | Technical documentation, READMEs, changelogs, and prose-generation skills              |
| `product`        | PRDs, user stories, roadmaps, OKRs, and product-spec workflows                         |
| `ai-tooling`     | LLM integration, MCP servers, prompt engineering, RAG, and agent frameworks            |
| `design`         | Figma workflows, design systems, typography, branding, and UX                          |
| `dx`             | Build tools, linters, formatters, scaffolding, and monorepo tooling                    |
| `git`            | Branching strategies, commit conventions, PR workflows, and release automation         |
| `data`           | SQL, ETL pipelines, data visualization, analytics, and notebook environments           |
| `security`       | OWASP hardening, secrets management, compliance, encryption, and pen-testing           |
| `mobile`         | iOS, Android, React Native, Flutter, and cross-platform app development                |
| `research`       | Investigative workflows, competitive analysis, synthesis, and evaluation               |
| `hardware`       | Embedded systems, microcontrollers, Arduino, Raspberry Pi, and firmware                |

## Tags

A skill can have multiple tags.

| Tag             | Matches skills involving                               |
| --------------- | ------------------------------------------------------ |
| `react`         | React components, JSX/TSX                              |
| `vue`           | Vue, Vuex, Pinia, Nuxt                                 |
| `svelte`        | Svelte, SvelteKit                                      |
| `typescript`    | TypeScript, strict-mode typing                         |
| `python`        | Python, Django, Flask, FastAPI                         |
| `golang`        | Go / Golang                                            |
| `rust`          | Rust, Cargo, WebAssembly                               |
| `node`          | Node.js, Express, NestJS, Fastify, Hono                |
| `css`           | CSS, Tailwind, Sass/SCSS, PostCSS                      |
| `next`          | Next.js (App Router or Pages Router)                   |
| `vite`          | Vite build tooling                                     |
| `electron`      | Electron desktop apps, main/renderer IPC               |
| `flutter`       | Flutter, Dart                                          |
| `react-native`  | React Native, Expo, Capacitor                          |
| `cli`           | Command-line tools, shell scripting, npx workflows     |
| `mcp`           | Model Context Protocol servers and integrations        |
| `terraform`     | Terraform, OpenTofu, HCL                               |
| `github`        | GitHub, GitHub Actions, GitHub CLI                     |
| `gitlab`        | GitLab, GitLab CI                                      |
| `docker`        | Docker, Compose, Podman, containers                    |
| `docs`          | Documentation generation, READMEs, changelogs          |
| `api`           | REST APIs, OpenAPI/Swagger specs                       |
| `graphql`       | GraphQL schemas, Apollo, Relay                         |
| `ui`            | UI components, forms, modals, widgets                  |
| `testing`       | Test authoring across any framework                    |
| `e2e`           | End-to-end tests — Playwright, Cypress, Selenium       |
| `review`        | Code review, PR review workflows                       |
| `refactor`      | Refactoring, cleanup, simplification                   |
| `naming`        | Variable, function, and identifier naming              |
| `diagrams`      | Mermaid, PlantUML, flowcharts, sequence diagrams, ERDs |
| `design-system` | Component libraries, design tokens, Storybook, Shadcn  |
| `seo`           | SEO, Open Graph, sitemaps, metadata                    |
| `sql`           | SQL queries, PostgreSQL, MySQL, SQLite, ORMs           |
| `branding`      | Brand identity, logos, color palettes                  |

## Managing labels

Click **Manage Labels** in the Registry tab toolbar to open the label management modal. From here you can view, edit, and organize labels across your entire registry at once.

**Browse and filter** — the skill list supports search by name, filter by category or tags (multi-select), and sort by name, category, or uncategorized-first.

**Inline editing** — click a category badge (or the `—` placeholder) to get a dropdown and change the category directly. Tag chips have **✕** buttons to remove them; the **+** button adds a new tag inline. Changes save immediately.

**Bulk clear** — select one or more skills with the checkboxes, then open **Actions → Clear labels**. A confirmation dialog shows the count before executing.

**Open skill [↗]** — each row has a hover-revealed button that opens the skill's full detail drawer above the modal, for richer editing (SKILL.md preview, install, origin, etc.).

## Auto-Generate Labels

Inside the Manage Labels modal, click **✦ Auto-Generate Labels…** to open a three-step flow that suggests category and tag values based on each skill's name and description.

**Step 1 — Scope:** Choose whether to generate categories only, tags only, or both.

**Step 2 — Skills:** Apply to all skills or select specific ones from a searchable checklist.

**Step 3 — Review:** Each skill that would change shows a diff of current versus proposed values. Rows are checked by default — uncheck any you want to exclude. Click **Apply changes** to commit the checked rows, or **Discard changes** to exit without writing anything. Partial apply is supported: the footer shows "Apply 2 of 4" when not all are selected.

## Editing labels per skill

Open any skill in the detail drawer and use the **Labels** section to:

- Change the category with the dropdown (saved immediately)
- Remove a tag with **✕** on its chip
- Add a tag with **+ Add tag**

Click **Auto Categorize** to run the suggestion engine for that one skill — it pre-fills category and tags based on the skill's name and description, saved immediately.

Label edits are per-skill and persist across registry syncs.
