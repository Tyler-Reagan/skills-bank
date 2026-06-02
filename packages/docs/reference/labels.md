# Skill labels

Skills Bank auto-derives a **category** and zero or more **tags** for every skill in your registry, based on its name and description. Labels are computed at runtime from static rule tables — nothing is baked into `index.json` or the skill's `SKILL.md` frontmatter.

Auto-derived tags appear on skill cards in the Browse grid, power the **Tags ▾** filter dropdown, and are matched during free-text search. Skills with no explicit `tags:` in their `SKILL.md` frontmatter still receive inferred tags.

You can override any auto-derived label from the skill detail drawer. Overrides are stored in `labels.json` in your app data directory and never touch the skill files themselves.

## Browse navigation

Skills are grouped into collapsible category sections. When two or more sections are visible, a **Collapse all / Expand all** toggle appears in the results row — click it to fold or unfold every section at once. Individual sections can still be toggled independently.

<!-- NEW SCREENSHOT (placeholder): this page has no image. Add one showing the Labels section of the detail drawer (category select + tag chips) and/or the collapsible category grouping in the Browse tab. Suggested path: /images/labels.png -->

## Categories

Each skill gets at most one category. The first matching rule wins.

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

Skills with no matching category appear under **Uncategorized** in the Browse tab.

## Tags

A skill can have multiple tags. All matching rules fire — order does not matter.

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

## Overriding labels

Open any skill in the detail drawer and use the **Labels** section to:

- Change the category with the dropdown (saved immediately)
- Remove an auto-derived tag with **✕** (moves it to the rejected list)
- Add a tag not in the auto-derived set with **+ Add tag**
- Restore a rejected tag by clicking it in the rejected row

Overrides are per-skill and persist across registry syncs. To reset a skill back to fully auto-derived labels, use **Reset labels** in the same section.
