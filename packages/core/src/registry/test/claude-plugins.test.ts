import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readInstalledPlugins,
  readPluginSkills,
  type InstalledPluginEntry,
} from "../claude-plugins.js";

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claude-plugins-"));
}

function writeSkill(
  dir: string,
  relSkillPath: string,
  frontmatter: { name?: string; description?: string },
): void {
  const skillDir = path.join(dir, relSkillPath);
  fs.mkdirSync(skillDir, { recursive: true });
  const lines = ["---"];
  if (frontmatter.name !== undefined) lines.push(`name: ${frontmatter.name}`);
  if (frontmatter.description !== undefined)
    lines.push(`description: ${frontmatter.description}`);
  lines.push("---", "", "Body.");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), lines.join("\n"), "utf8");
}

function writePluginManifest(installPath: string, skills: string[]): void {
  const pluginDir = path.join(installPath, ".claude-plugin");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify({ name: "fixture-plugin", skills }),
    "utf8",
  );
}

describe("readInstalledPlugins", () => {
  test("returns [] when the manifest is absent, silently", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      readInstalledPlugins(
        path.join(os.tmpdir(), "does-not-exist-installed_plugins.json"),
      ),
    ).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("returns [] and logs on malformed JSON", () => {
    const dir = mkTempDir();
    const manifestPath = path.join(dir, "installed_plugins.json");
    fs.writeFileSync(manifestPath, "{ not json", "utf8");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(readInstalledPlugins(manifestPath)).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain("unparseable");
    } finally {
      spy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flattens the <plugin>@<marketplace> keyed map, splitting on the last @", () => {
    const dir = mkTempDir();
    const manifestPath = path.join(dir, "installed_plugins.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 2,
        plugins: {
          "mattpocock-skills@claude-plugins-official": [
            {
              scope: "user",
              installPath: "/fake/mattpocock-skills/1.2.3",
              version: "1.2.3",
            },
          ],
        },
      }),
      "utf8",
    );
    try {
      expect(readInstalledPlugins(manifestPath)).toEqual([
        {
          pluginName: "mattpocock-skills",
          marketplaceName: "claude-plugins-official",
          installPath: "/fake/mattpocock-skills/1.2.3",
          version: "1.2.3",
        },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips a version entry with no installPath", () => {
    const dir = mkTempDir();
    const manifestPath = path.join(dir, "installed_plugins.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 2,
        plugins: { "plugin@market": [{ scope: "user" }] },
      }),
      "utf8",
    );
    try {
      expect(readInstalledPlugins(manifestPath)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readPluginSkills", () => {
  test("resolves a plugin's declared skills into ClaudePluginSkill rows", () => {
    const dir = mkTempDir();
    const installPath = path.join(dir, "fixture-plugin", "1.0.0");
    writePluginManifest(installPath, ["./skills/foo", "./skills/bar"]);
    writeSkill(installPath, "skills/foo", {
      name: "foo",
      description: "Does foo things.",
    });
    writeSkill(installPath, "skills/bar", { name: "bar" });

    const entries: InstalledPluginEntry[] = [
      {
        pluginName: "fixture-plugin",
        marketplaceName: "acme-market",
        installPath,
        version: "1.0.0",
      },
    ];
    try {
      const result = readPluginSkills(entries);
      expect(result).toEqual([
        {
          name: "foo",
          description: "Does foo things.",
          pluginName: "fixture-plugin",
          marketplaceName: "acme-market",
          skillPath: path.join(installPath, "skills", "foo"),
        },
        {
          name: "bar",
          pluginName: "fixture-plugin",
          marketplaceName: "acme-market",
          skillPath: path.join(installPath, "skills", "bar"),
        },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips a skill path with no SKILL.md", () => {
    const dir = mkTempDir();
    const installPath = path.join(dir, "fixture-plugin", "1.0.0");
    writePluginManifest(installPath, ["./skills/missing"]);

    try {
      expect(
        readPluginSkills([
          {
            pluginName: "fixture-plugin",
            marketplaceName: "acme-market",
            installPath,
          },
        ]),
      ).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("auto-discovers skills/<name>/SKILL.md by convention when plugin.json has no skills field", () => {
    const dir = mkTempDir();
    const installPath = path.join(dir, "fixture-plugin", "1.0.0");
    fs.mkdirSync(path.join(installPath, ".claude-plugin"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(installPath, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "fixture-plugin" }),
      "utf8",
    );
    writeSkill(installPath, "skills/foo", {
      name: "foo",
      description: "Does foo things.",
    });
    writeSkill(installPath, "skills/bar", { name: "bar" });

    try {
      const result = readPluginSkills([
        {
          pluginName: "fixture-plugin",
          marketplaceName: "acme-market",
          installPath,
        },
      ]);
      expect(result.map((s) => s.name).sort()).toEqual(["bar", "foo"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an explicit skills field wins outright over the convention scan", () => {
    const dir = mkTempDir();
    const installPath = path.join(dir, "fixture-plugin", "1.0.0");
    // skills/engineering/tdd is declared explicitly; skills/other-thing is
    // NOT declared and sits at the convention depth (skills/<name>) — it
    // must be ignored once an explicit skills field is present.
    writePluginManifest(installPath, ["./skills/engineering/tdd"]);
    writeSkill(installPath, "skills/engineering/tdd", { name: "tdd" });
    writeSkill(installPath, "skills/other-thing", { name: "other-thing" });

    try {
      const result = readPluginSkills([
        {
          pluginName: "fixture-plugin",
          marketplaceName: "acme-market",
          installPath,
        },
      ]);
      expect(result.map((s) => s.name)).toEqual(["tdd"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("convention scan yields nothing when there is no skills/ directory at all", () => {
    const dir = mkTempDir();
    const installPath = path.join(dir, "fixture-plugin", "1.0.0");
    fs.mkdirSync(path.join(installPath, ".claude-plugin"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(installPath, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "fixture-plugin" }),
      "utf8",
    );

    try {
      expect(
        readPluginSkills([
          {
            pluginName: "fixture-plugin",
            marketplaceName: "acme-market",
            installPath,
          },
        ]),
      ).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips a plugin whose plugin.json is missing or unparseable", () => {
    const dir = mkTempDir();
    const installPath = path.join(dir, "fixture-plugin", "1.0.0");
    fs.mkdirSync(installPath, { recursive: true });

    try {
      expect(
        readPluginSkills([
          {
            pluginName: "fixture-plugin",
            marketplaceName: "acme-market",
            installPath,
          },
        ]),
      ).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
