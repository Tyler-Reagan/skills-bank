# ADR-0033 — Store, Discover, Agents, Metrics

**Status:** Accepted

The desktop tabs are **Store**, **Discover**, **Agents** (working name; the spec may rename it), and **Metrics**. Installed as a tab is gone.

Store is the Store: skill grid, Labels, Needs attention (Skill Diagnostic and Conflict). Discover is the skills.sh catalog plus in-app Add. Agents holds Claude and Cursor package artifacts — Plugin inventory now, more later — and is the view for overlap between Plugin-shipped skills and Store skills. Nested routes and layout wait for `/to-spec`. Plugin inventory leaves Discover. Handmade `~/.cursor/skills` folders stay out of the Store.
