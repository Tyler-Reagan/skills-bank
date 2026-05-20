import { describe, expect, test } from "vitest";
import { parseGithubSkillUrl } from "./origin-url.js";

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
