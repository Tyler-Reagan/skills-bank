export const categoryRules: { category: string; keywords: string[] }[] = [
  {
    category: "frontend",
    keywords: [
      "react",
      "vue",
      "angular",
      "svelte",
      "nextjs",
      "next",
      "nuxt",
      "frontend",
      "ui",
      "css",
      "html",
      "tailwind",
      "shadcn",
      "component",
      "button",
      "modal",
      "navbar",
      "sidebar",
      "layout",
      "responsive",
      "animation",
      "glassmorphism",
      "neumorphism",
      "bento",
    ],
  },
  {
    category: "backend",
    keywords: [
      "backend",
      "server",
      "node",
      "nodejs",
      "expressjs",
      "fastify",
      "nestjs",
      "hono",
      "database",
      "postgres",
      "postgresql",
      "mysql",
      "sqlite",
      "redis",
      "orm",
      "prisma",
      "drizzle",
      "auth",
      "authentication",
      "authorization",
      "jwt",
      "oauth",
      "session",
      "middleware",
      "rest",
      "graphql",
      "websocket",
      "queue",
      "job",
      "worker",
    ],
  },
  {
    category: "infrastructure",
    keywords: [
      "terraform",
      "kubernetes",
      "k8s",
      "docker",
      "aws",
      "gcp",
      "azure",
      "infra",
      "infrastructure",
      "devops",
      "pipeline",
      "helm",
      "serverless",
      "cloud",
      "deployment",
      "deploy",
      "ci",
      "cd",
      "nginx",
      "caddy",
      "loadbalancer",
      "monitoring",
      "observability",
      "logging",
    ],
  },
  {
    category: "testing",
    keywords: [
      "test",
      "testing",
      "jest",
      "vitest",
      "playwright",
      "cypress",
      "e2e",
      "unit",
      "integration",
      "mock",
      "fixture",
      "assertion",
      "spec",
      "tdd",
      "bdd",
      "coverage",
      "snapshot",
    ],
  },
  {
    category: "writing",
    keywords: [
      "writing",
      "copywriting",
      "blog",
      "content",
      "markdown",
      "documentation",
      "readme",
      "changelog",
      "docs",
      "docstring",
      "article",
      "technical",
      "jsdoc",
    ],
  },
  {
    category: "product",
    keywords: [
      "product",
      "prd",
      "spec",
      "specification",
      "requirements",
      "roadmap",
      "okr",
      "userstory",
      "story",
      "epic",
      "backlog",
      "sprint",
      "milestone",
      "stakeholder",
      "persona",
    ],
  },
  {
    category: "ai-tooling",
    keywords: [
      "ai",
      "llm",
      "claude",
      "openai",
      "anthropic",
      "mcp",
      "agent",
      "prompt",
      "embedding",
      "rag",
      "vector",
      "chatbot",
      "genai",
      "generative",
      "finetuning",
      "inference",
    ],
  },
  {
    category: "design",
    keywords: [
      "design",
      "figma",
      "sketch",
      "branding",
      "brand",
      "color",
      "palette",
      "typography",
      "font",
      "logo",
      "mockup",
      "wireframe",
      "icon",
      "illustration",
      "ux",
      "accessibility",
      "a11y",
    ],
  },
  {
    category: "dx",
    keywords: [
      "dx",
      "developer",
      "experience",
      "vite",
      "webpack",
      "esbuild",
      "rollup",
      "bundler",
      "eslint",
      "prettier",
      "lint",
      "format",
      "cli",
      "terminal",
      "shell",
      "tooling",
      "scaffold",
      "boilerplate",
      "template",
      "generator",
      "monorepo",
      "turbo",
      "nx",
    ],
  },
  {
    category: "git",
    keywords: [
      "git",
      "github",
      "gitlab",
      "pullrequest",
      "commit",
      "branch",
      "merge",
      "rebase",
      "diff",
      "worktree",
      "versioning",
      "release",
      "tag",
    ],
  },
  {
    category: "data",
    keywords: [
      "sql",
      "query",
      "database",
      "etl",
      "pipeline",
      "pandas",
      "dbt",
      "spark",
      "bigquery",
      "snowflake",
      "analytics",
      "dashboard",
      "chart",
      "graph",
      "visualization",
      "viz",
      "d3",
      "recharts",
      "plotly",
      "metric",
      "dataset",
      "dataframe",
      "notebook",
      "jupyter",
    ],
  },
  {
    category: "security",
    keywords: [
      "security",
      "owasp",
      "vulnerability",
      "cve",
      "pentest",
      "secrets",
      "encryption",
      "tls",
      "ssl",
      "xss",
      "csrf",
      "injection",
      "sanitize",
      "compliance",
      "gdpr",
      "privacy",
      "audit",
    ],
  },
  {
    category: "mobile",
    keywords: [
      "mobile",
      "ios",
      "android",
      "swift",
      "swiftui",
      "kotlin",
      "flutter",
      "reactnative",
      "expo",
      "capacitor",
      "app",
      "native",
    ],
  },
  {
    category: "research",
    keywords: [
      "research",
      "investigate",
      "analysis",
      "survey",
      "compare",
      "evaluation",
      "report",
      "synthesis",
      "competitive",
    ],
  },
  {
    category: "hardware",
    keywords: [
      "hardware",
      "keyboard",
      "qmk",
      "firmware",
      "embedded",
      "arduino",
      "raspberry",
      "microcontroller",
      "iot",
      "gpio",
      "sensor",
      "circuit",
    ],
  },
];

export const tagRules: { tag: string; keywords: string[] }[] = [
  { tag: "react", keywords: ["react", "jsx", "tsx"] },
  { tag: "vue", keywords: ["vue", "vuex", "pinia", "nuxt"] },
  { tag: "svelte", keywords: ["svelte", "sveltekit"] },
  { tag: "typescript", keywords: ["typescript", "typesafe", "strictmode"] },
  {
    tag: "python",
    keywords: ["python", "django", "flask", "fastapi", "asyncio", "pip"],
  },
  { tag: "golang", keywords: ["golang", "gopher", "goroutine"] },
  { tag: "rust", keywords: ["rust", "cargo", "rustacean", "wasm"] },
  {
    tag: "node",
    keywords: [
      "node",
      "nodejs",
      "npm",
      "expressjs",
      "nestjs",
      "fastify",
      "hono",
    ],
  },
  {
    tag: "css",
    keywords: ["css", "stylesheet", "tailwind", "sass", "scss", "postcss"],
  },
  { tag: "next", keywords: ["nextjs", "appdir", "approuter", "pagerouter"] },
  { tag: "vite", keywords: ["vite", "vitejs"] },
  { tag: "electron", keywords: ["electron", "ipc", "renderer", "mainprocess"] },
  { tag: "flutter", keywords: ["flutter", "dart"] },
  { tag: "react-native", keywords: ["reactnative", "expo", "capacitor"] },
  {
    tag: "cli",
    keywords: ["cli", "commandline", "terminal", "shell", "bash", "zsh", "npx"],
  },
  { tag: "mcp", keywords: ["mcp", "modelcontextprotocol", "contextprotocol"] },
  { tag: "terraform", keywords: ["terraform", "hcl", "tfvars", "opentofu"] },
  { tag: "github", keywords: ["github", "ghcli", "githubactions", "octokit"] },
  { tag: "gitlab", keywords: ["gitlab", "gitlabci"] },
  {
    tag: "docker",
    keywords: ["docker", "dockerfile", "compose", "container", "podman"],
  },
  {
    tag: "docs",
    keywords: [
      "docs",
      "documentation",
      "readme",
      "changelog",
      "docstring",
      "jsdoc",
    ],
  },
  {
    tag: "api",
    keywords: ["api", "rest", "endpoint", "openapi", "swagger", "http"],
  },
  { tag: "graphql", keywords: ["graphql", "gql", "apollo", "relay"] },
  {
    tag: "ui",
    keywords: [
      "ui",
      "interface",
      "component",
      "button",
      "modal",
      "form",
      "input",
      "widget",
    ],
  },
  {
    tag: "testing",
    keywords: [
      "test",
      "testing",
      "spec",
      "jest",
      "vitest",
      "playwright",
      "cypress",
      "e2e",
    ],
  },
  {
    tag: "e2e",
    keywords: ["e2e", "endtoend", "playwright", "cypress", "selenium"],
  },
  { tag: "review", keywords: ["review", "codereview", "prreview"] },
  {
    tag: "refactor",
    keywords: ["refactor", "refactoring", "cleanup", "simplify", "restructure"],
  },
  {
    tag: "naming",
    keywords: ["naming", "variable", "identifier", "rename", "convention"],
  },
  {
    tag: "diagrams",
    keywords: [
      "diagram",
      "mermaid",
      "plantuml",
      "flowchart",
      "sequence",
      "erd",
    ],
  },
  {
    tag: "design-system",
    keywords: [
      "designsystem",
      "componentlibrary",
      "token",
      "theme",
      "storybook",
      "shadcn",
    ],
  },
  {
    tag: "seo",
    keywords: ["seo", "searchengine", "sitemap", "opengraph", "metadata"],
  },
  {
    tag: "sql",
    keywords: [
      "sql",
      "query",
      "postgres",
      "postgresql",
      "mysql",
      "sqlite",
      "orm",
      "prisma",
      "drizzle",
    ],
  },
  {
    tag: "branding",
    keywords: ["brand", "branding", "logo", "identity", "colorpalette"],
  },
];

export interface SkillLabelOverride {
  category?: string | null;
  tags?: string[];
  /** App-level meta stored under the "__meta" key in the labels map. */
  bannerDismissed?: boolean;
}

export type LabelsMap = Record<string, SkillLabelOverride>;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const CATEGORY_DISPLAY_OVERRIDES: Record<string, string> = {
  "ai-tooling": "AI Tooling",
  dx: "DX",
};

export function categoryDisplayName(category: string): string {
  return (
    CATEGORY_DISPLAY_OVERRIDES[category] ??
    category
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

export function deriveLabels(skill: { name: string; description: string }): {
  category: string | null;
  tags: string[];
} {
  const tokens = new Set(tokenize(`${skill.name} ${skill.description}`));

  let category: string | null = null;
  for (const rule of categoryRules) {
    if (rule.keywords.some((kw) => tokens.has(kw))) {
      category = rule.category;
      break;
    }
  }

  const tags: string[] = [];
  for (const rule of tagRules) {
    if (rule.keywords.some((kw) => tokens.has(kw))) {
      tags.push(rule.tag);
    }
  }

  return { category, tags };
}

export function effectiveLabels(
  derived: { category: string | null; tags: string[] },
  override?: SkillLabelOverride,
): { category: string | null; tags: string[] } {
  if (!override) return derived;

  const category =
    override.category !== undefined ? override.category : derived.category;

  const added = override.tags ?? [];
  const tags = [
    ...derived.tags,
    ...added.filter((t) => !derived.tags.includes(t)),
  ];

  return { category, tags };
}
