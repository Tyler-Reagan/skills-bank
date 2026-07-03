export const categories: { slug: string; display: string }[] = [
  {
    slug: "engineering:library-api-reference",
    display: "Engineering: Library & API Reference",
  },
  {
    slug: "engineering:code-scaffolding",
    display: "Engineering: Code Scaffolding",
  },
  { slug: "engineering:code-review", display: "Engineering: Code Review" },
  { slug: "engineering:verification", display: "Engineering: Verification" },
  { slug: "engineering:diagnostics", display: "Engineering: Diagnostics" },
  {
    slug: "engineering:ci-cd-deployment",
    display: "Engineering: CI/CD & Deployment",
  },
  {
    slug: "engineering:infrastructure",
    display: "Engineering: Infrastructure",
  },
  {
    slug: "engineering:data-analysis",
    display: "Engineering: Data & Analysis",
  },
  { slug: "research:investigation", display: "Research: Investigation" },
  { slug: "research:synthesis", display: "Research: Synthesis" },
  { slug: "research:evaluation", display: "Research: Evaluation" },
  { slug: "business:planning", display: "Business: Planning" },
  {
    slug: "business:process-automation",
    display: "Business: Process Automation",
  },
  { slug: "business:communication", display: "Business: Communication" },
  { slug: "business:reporting", display: "Business: Reporting" },
  { slug: "creative:writing", display: "Creative: Writing" },
  { slug: "creative:design", display: "Creative: Design" },
  { slug: "creative:brainstorming", display: "Creative: Brainstorming" },
  { slug: "productivity:focus", display: "Productivity: Focus" },
  {
    slug: "productivity:knowledge-management",
    display: "Productivity: Knowledge Management",
  },
  {
    slug: "productivity:decision-support",
    display: "Productivity: Decision Support",
  },
];

export interface SkillLabelOverride {
  category?: string | null;
  tags?: string[];
  /** App-level meta stored under the "__meta" key in the labels map. */
  bannerDismissed?: boolean;
}

export type LabelsMap = Record<string, SkillLabelOverride>;

const CATEGORY_DISPLAY_MAP = new Map(
  categories.map((c) => [c.slug, c.display]),
);

const LEGACY_DISPLAY_OVERRIDES: Record<string, string> = {
  "ai-tooling": "AI Tooling",
  dx: "DX",
};

export function categoryDisplayName(category: string): string {
  return (
    CATEGORY_DISPLAY_MAP.get(category) ??
    LEGACY_DISPLAY_OVERRIDES[category] ??
    category
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
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

/**
 * Patch-merge a skill's user-set labels into the map and return a new
 * map (immutable; no I/O). The persistence boundary — reading/writing
 * the app's `labels.json` — stays with the Electron caller, since that
 * file lives in userData, not the registry. A batch update is just a
 * fold of this over each entry.
 */
export function applySkillLabel(
  map: LabelsMap,
  name: string,
  patch: SkillLabelOverride,
): LabelsMap {
  return { ...map, [name]: { ...(map[name] ?? {}), ...patch } };
}

/** Drop a skill's labels from the map and return a new map (immutable). */
export function clearSkillLabel(map: LabelsMap, name: string): LabelsMap {
  if (!(name in map)) return map;
  const next = { ...map };
  delete next[name];
  return next;
}
