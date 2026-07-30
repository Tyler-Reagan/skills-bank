import { describe, test, expect, vi, afterEach } from "vitest";
import {
  fetchClaudePluginManifest,
  mergePluginDeclaredSkills,
  type ClaudePluginManifest,
} from "../plugin-manifest.js";
import { MANIFEST_SCHEMA_VERSION, type RegistryManifest } from "../manifest.js";

const REPO_URL = "https://github.com/Tyler-Reagan/skills";

function manifest(skills: RegistryManifest["skills"]): RegistryManifest {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, skills };
}

describe("mergePluginDeclaredSkills", () => {
  test("adds a plugin-declared skill missing from the manifest", () => {
    const m = manifest([]);
    const plugin: ClaudePluginManifest = {
      name: "tyler-reagan-skills",
      skills: ["./skills/tools/audit-memories"],
    };
    const result = mergePluginDeclaredSkills(m, plugin, REPO_URL);
    expect(result.skills).toEqual([
      {
        name: "audit-memories",
        origin: {
          url: REPO_URL,
          skillPath: "skills/tools/audit-memories/SKILL.md",
        },
        category: null,
        tags: [],
      },
    ]);
  });

  test("skips a skill path already tracked under the same repo", () => {
    const m = manifest([
      {
        name: "audit-memories",
        origin: {
          url: REPO_URL,
          skillPath: "skills/tools/audit-memories/SKILL.md",
        },
        category: "tools",
        tags: ["memory"],
      },
    ]);
    const plugin: ClaudePluginManifest = {
      name: "tyler-reagan-skills",
      skills: ["./skills/tools/audit-memories"],
    };
    const result = mergePluginDeclaredSkills(m, plugin, REPO_URL);
    expect(result).toBe(m);
  });

  test("skips a name collision with a different origin", () => {
    const m = manifest([
      {
        name: "code-review",
        origin: {
          url: "https://github.com/mattpocock/skills",
          skillPath: "skills/engineering/code-review/SKILL.md",
        },
        category: null,
        tags: [],
      },
    ]);
    const plugin: ClaudePluginManifest = {
      name: "tyler-reagan-skills",
      skills: ["./skills/tools/code-review"],
    };
    const result = mergePluginDeclaredSkills(m, plugin, REPO_URL);
    expect(result).toBe(m);
  });

  test("no-ops (same reference) when there is nothing to add", () => {
    const m = manifest([]);
    const plugin: ClaudePluginManifest = { name: "x", skills: [] };
    expect(mergePluginDeclaredSkills(m, plugin, REPO_URL)).toBe(m);
  });
});

describe("fetchClaudePluginManifest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    const content = Buffer.from(JSON.stringify(body), "utf8").toString(
      "base64",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        statusText: "",
        headers: new Map(),
        text: async () => "",
        json: async () => ({ content, sha: "abc" }),
      })),
    );
  }

  test("returns the parsed manifest on success", async () => {
    stubFetch(200, {
      name: "tyler-reagan-skills",
      skills: ["./skills/tools/audit-memories"],
    });
    const result = await fetchClaudePluginManifest(
      "Tyler-Reagan/skills",
      "main",
      "token",
    );
    expect(result).toEqual({
      name: "tyler-reagan-skills",
      skills: ["./skills/tools/audit-memories"],
    });
  });

  test("returns null on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Map(),
        text: async () => "",
        json: async () => ({ message: "Not Found" }),
      })),
    );
    const result = await fetchClaudePluginManifest(
      "some/repo",
      "main",
      "token",
    );
    expect(result).toBeNull();
  });

  test("returns null when skills is missing or not an array", async () => {
    stubFetch(200, { name: "x" });
    const result = await fetchClaudePluginManifest(
      "some/repo",
      "main",
      "token",
    );
    expect(result).toBeNull();
  });
});
