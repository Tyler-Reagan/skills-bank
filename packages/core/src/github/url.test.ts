import { describe, expect, test } from "vitest";
import {
  parseGithubSkillUrl,
  parseNpxSkillsAdd,
  buildNpxSkillsAddCommand,
  buildTerminalHandoffCommand,
  normalizeOriginUrl,
} from "./url.js";

describe("normalizeOriginUrl", () => {
  test("strips a trailing .git", () => {
    expect(normalizeOriginUrl("https://github.com/o/r.git")).toBe(
      "https://github.com/o/r",
    );
  });
  test("strips trailing slashes then .git", () => {
    expect(normalizeOriginUrl("https://github.com/o/r.git/")).toBe(
      "https://github.com/o/r",
    );
  });
  test("leaves a clean url untouched", () => {
    expect(normalizeOriginUrl("https://github.com/o/r")).toBe(
      "https://github.com/o/r",
    );
  });
  test("null / undefined → null", () => {
    expect(normalizeOriginUrl(null)).toBeNull();
    expect(normalizeOriginUrl(undefined)).toBeNull();
  });
});

describe("parseGithubSkillUrl", () => {
  test("folder URL canonicalizes skillPath to <path>/SKILL.md", () => {
    const r = parseGithubSkillUrl(
      "https://github.com/owner/repo/tree/main/skills/find-skills",
    );
    expect(r).toEqual({
      repo: "owner/repo",
      skillPath: "skills/find-skills/SKILL.md",
      ref: "main",
    });
  });

  test("blob URL pointing at SKILL.md round-trips", () => {
    const r = parseGithubSkillUrl(
      "https://github.com/owner/repo/blob/main/skills/find-skills/SKILL.md",
    );
    expect(r).toEqual({
      repo: "owner/repo",
      skillPath: "skills/find-skills/SKILL.md",
      ref: "main",
    });
  });

  test("flat-rooted skill (Tyler-Reagan/skills layout)", () => {
    const r = parseGithubSkillUrl(
      "https://github.com/Tyler-Reagan/skills/tree/main/pretty-mermaid",
    );
    expect(r).toEqual({
      repo: "Tyler-Reagan/skills",
      skillPath: "pretty-mermaid/SKILL.md",
      ref: "main",
    });
  });

  test("non-main branches preserved in ref", () => {
    const r = parseGithubSkillUrl(
      "https://github.com/owner/repo/tree/develop/skills/x",
    );
    expect(r).toEqual({
      repo: "owner/repo",
      skillPath: "skills/x/SKILL.md",
      ref: "develop",
    });
  });

  test("repo-root URL → not-a-skill-folder", () => {
    const r = parseGithubSkillUrl("https://github.com/owner/repo");
    expect("kind" in r && r.kind).toBe("not-a-skill-folder");
  });

  test("tree URL with no path → not-a-skill-folder", () => {
    const r = parseGithubSkillUrl("https://github.com/owner/repo/tree/main");
    expect("kind" in r && r.kind).toBe("not-a-skill-folder");
  });

  test("blob URL not ending in SKILL.md → not-a-skill-folder", () => {
    const r = parseGithubSkillUrl(
      "https://github.com/owner/repo/blob/main/skills/x/references/themes.md",
    );
    expect("kind" in r && r.kind).toBe("not-a-skill-folder");
  });

  test("non-github URL → not-github", () => {
    const r = parseGithubSkillUrl("https://gitlab.com/owner/repo");
    expect("kind" in r && r.kind).toBe("not-github");
  });

  test("malformed URL → malformed", () => {
    const r = parseGithubSkillUrl("not a url at all");
    expect("kind" in r && r.kind).toBe("malformed");
  });

  test("malformed: github.com/<owner>-only", () => {
    const r = parseGithubSkillUrl("https://github.com/owner");
    expect("kind" in r && r.kind).toBe("malformed");
  });

  test("malformed: invalid ref-type segment", () => {
    const r = parseGithubSkillUrl(
      "https://github.com/owner/repo/raw/main/skills/x",
    );
    expect("kind" in r && r.kind).toBe("malformed");
  });

  test("www.github.com host also accepted", () => {
    const r = parseGithubSkillUrl(
      "https://www.github.com/owner/repo/tree/main/skills/x",
    );
    expect("repo" in r && r.repo).toBe("owner/repo");
  });

  test("leading + trailing whitespace tolerated", () => {
    const r = parseGithubSkillUrl(
      "  https://github.com/owner/repo/tree/main/skills/x  ",
    );
    expect("repo" in r && r.repo).toBe("owner/repo");
  });
});

describe("parseNpxSkillsAdd", () => {
  test("extracts {repo, skillName} from the skills.sh command", () => {
    const r = parseNpxSkillsAdd(
      "npx skills add https://github.com/mattpocock/skills --skill wayfinder",
    );
    expect(r).toEqual({ repo: "mattpocock/skills", skillName: "wayfinder" });
  });

  test("tolerates surrounding whitespace and a trailing repo slash", () => {
    const r = parseNpxSkillsAdd(
      "  npx skills add https://github.com/o/r/ --skill foo  ",
    );
    expect(r).toEqual({ repo: "o/r", skillName: "foo" });
  });

  test("returns null when there is no --skill flag", () => {
    expect(
      parseNpxSkillsAdd("npx skills add https://github.com/o/r"),
    ).toBeNull();
  });

  test("returns null for a plain GitHub URL", () => {
    expect(
      parseNpxSkillsAdd("https://github.com/o/r/tree/main/skills/x"),
    ).toBeNull();
  });

  test("returns null for a non-GitHub source", () => {
    expect(
      parseNpxSkillsAdd("npx skills add https://gitlab.com/o/r --skill foo"),
    ).toBeNull();
  });

  test("does not touch the network (pure) — resolves synchronously", () => {
    // A pure parse returns immediately; if this were async/probing it
    // would return a Promise. Guards the url.ts network-free invariant.
    const r = parseNpxSkillsAdd(
      "npx skills add https://github.com/o/r --skill foo",
    );
    expect(r).not.toBeInstanceOf(Promise);
  });
});

describe("buildNpxSkillsAddCommand", () => {
  test("re-emits the canonical skills.sh command with the full repo URL", () => {
    expect(
      buildNpxSkillsAddCommand({
        repo: "mattpocock/skills",
        skillName: "wayfinder",
      }),
    ).toBe(
      "npx skills add https://github.com/mattpocock/skills --skill wayfinder",
    );
  });
});

describe("buildTerminalHandoffCommand", () => {
  test("rebuilds the canonical command from a pasted npx command", () => {
    // Round-trips through parse → build, normalising a trailing repo slash
    // and surrounding whitespace back to the canonical form.
    expect(
      buildTerminalHandoffCommand(
        "  npx skills add https://github.com/o/r/ --skill foo  ",
      ),
    ).toBe("npx skills add https://github.com/o/r --skill foo");
  });

  test("hands a GitHub skill-folder URL to npx directly", () => {
    expect(
      buildTerminalHandoffCommand(
        "https://github.com/o/r/tree/main/skills/engineering/wayfinder",
      ),
    ).toBe(
      "npx skills add https://github.com/o/r/tree/main/skills/engineering/wayfinder",
    );
  });

  test("returns null for empty / whitespace / missing input", () => {
    expect(buildTerminalHandoffCommand("")).toBeNull();
    expect(buildTerminalHandoffCommand("   ")).toBeNull();
    expect(buildTerminalHandoffCommand(null)).toBeNull();
    expect(buildTerminalHandoffCommand(undefined)).toBeNull();
  });

  test("returns null for a repo-root URL that isn't a skill folder", () => {
    expect(buildTerminalHandoffCommand("https://github.com/o/r")).toBeNull();
  });

  test("returns null for unrecognised input", () => {
    expect(buildTerminalHandoffCommand("just some text")).toBeNull();
  });

  test("does not touch the network (pure) — resolves synchronously", () => {
    const r = buildTerminalHandoffCommand(
      "npx skills add https://github.com/o/r --skill foo",
    );
    expect(r).not.toBeInstanceOf(Promise);
  });
});
