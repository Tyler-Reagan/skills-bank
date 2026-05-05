import React from "react";
import type { RegistryEntry } from "@skills-bank/core";

const DOMAIN_TOKENS: Record<string, { color: string; dim: string }> = {
  design: { color: "var(--design)", dim: "var(--design-dim)" },
  code: { color: "var(--code)", dim: "var(--code-dim)" },
  content: { color: "var(--content)", dim: "var(--content-dim)" },
  data: { color: "var(--data)", dim: "var(--data-dim)" },
  meta: { color: "var(--meta)", dim: "var(--meta-dim)" },
  other: { color: "var(--other)", dim: "var(--other-dim)" },
};

const ORDER = ["code", "content", "data", "design", "meta", "other"];

interface Props {
  registry: RegistryEntry[];
  selected: string | null;
  onChange: (domain: string | null) => void;
}

export function DomainFilter({
  registry,
  selected,
  onChange,
}: Props): React.ReactElement {
  const counts = new Map<string, number>();
  for (const e of registry) {
    const d = e.domain ?? "other";
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const visible = ORDER.filter((d) => counts.get(d));
  return (
    <div className="domain-filter">
      <button
        className={`domain-pill ${selected === null ? "active" : ""}`}
        onClick={() => onChange(null)}
      >
        All <span className="count">{registry.length}</span>
      </button>
      {visible.map((d) => {
        const tok = DOMAIN_TOKENS[d] ?? DOMAIN_TOKENS["other"]!;
        const isActive = selected === d;
        return (
          <button
            key={d}
            className={`domain-pill ${isActive ? "active" : ""}`}
            style={
              isActive
                ? ({
                    "--pill-color": tok.color,
                    "--pill-dim": tok.dim,
                  } as React.CSSProperties)
                : undefined
            }
            onClick={() => onChange(isActive ? null : d)}
          >
            {d} <span className="count">{counts.get(d)}</span>
          </button>
        );
      })}
    </div>
  );
}
