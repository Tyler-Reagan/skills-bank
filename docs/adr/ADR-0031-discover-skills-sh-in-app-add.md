# ADR-0031 — Discover is the skills.sh catalog plus in-app Add

**Status:** Accepted

Discover stays. skills.sh remains the catalog (embedded). Acquiring a skill is Fetch then Add into the Store. The packaged app still never spawns `npx`, so Open Terminal is not an Add path. Users who want the real CLI run it themselves. Plugin inventory lives on the Agents tab ([ADR-0033](./ADR-0033-store-discover-agents-metrics-ia.md)), not on Discover.

Fetch stays a GitHub-capability call-site check. Add does not Project. After cutover, a skill npx already wrote into `~/.agents/skills` is already in the Store; Discover does not "adopt" it into a second home.
