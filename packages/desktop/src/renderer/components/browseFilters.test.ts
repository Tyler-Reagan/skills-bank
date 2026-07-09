import { describe, expect, test } from "vitest";
import type { RegistryEntry } from "@skills-bank/core";
import {
  applyChipFilters,
  applyFilters,
  applySort,
  floatToTop,
  type RegistryFilterTag,
} from "./browseFilters.js";

/** Minimal RegistryEntry factory — only the fields the filters read. */
function entry(name: string, over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    name,
    description: name,
    path: `skills/${name}`,
    origin: { url: null },
    ...over,
  };
}

describe("applyChipFilters", () => {
  const reg = [
    entry("a", { bucket: "personal", skillUpdateAvailable: true }),
    entry("b", { bucket: "vendored", drift: true }),
    entry("c", { bucket: "vendored", skillUpdateAvailable: true }),
  ];

  test("empty active set passes everything through (same reference)", () => {
    const active = new Set<RegistryFilterTag>();
    expect(applyChipFilters(reg, active)).toBe(reg);
  });

  test("single chip filters to matches", () => {
    const active = new Set<RegistryFilterTag>(["vendored"]);
    expect(applyChipFilters(reg, active).map((e) => e.name)).toEqual([
      "b",
      "c",
    ]);
  });

  test("multiple chips combine with AND", () => {
    const active = new Set<RegistryFilterTag>(["vendored", "updates"]);
    expect(applyChipFilters(reg, active).map((e) => e.name)).toEqual(["c"]);
  });

  test("mutually-exclusive chips collapse to empty", () => {
    const active = new Set<RegistryFilterTag>(["personal", "vendored"]);
    expect(applyChipFilters(reg, active)).toEqual([]);
  });
});

describe("applySort", () => {
  test("name sort is locale-aware and case-insensitive-ish, respecting direction", () => {
    const reg = [entry("Charlie"), entry("alpha"), entry("Bravo")];
    expect(
      applySort(reg, { by: "name", direction: "asc" }).map((e) => e.name),
    ).toEqual(["alpha", "Bravo", "Charlie"]);
    expect(
      applySort(reg, { by: "name", direction: "desc" }).map((e) => e.name),
    ).toEqual(["Charlie", "Bravo", "alpha"]);
  });

  test("does not mutate the input array", () => {
    const reg = [entry("b"), entry("a")];
    const before = reg.map((e) => e.name);
    applySort(reg, { by: "name", direction: "asc" });
    expect(reg.map((e) => e.name)).toEqual(before);
  });

  test("age sort orders by lastCommit.date; missing dates sink to the end in both directions", () => {
    const withDate = (name: string, date?: string) =>
      entry(name, date ? { lastCommit: { sha: "x", date, message: "m" } } : {});
    const reg = [
      withDate("new", "2026-06-01T00:00:00Z"),
      withDate("none"),
      withDate("old", "2020-01-01T00:00:00Z"),
    ];
    // asc = oldest first (surface stale), unknown-age last
    expect(
      applySort(reg, { by: "age", direction: "asc" }).map((e) => e.name),
    ).toEqual(["old", "new", "none"]);
    // desc = newest first, unknown-age still last
    expect(
      applySort(reg, { by: "age", direction: "desc" }).map((e) => e.name),
    ).toEqual(["new", "old", "none"]);
  });
});

describe("applyFilters", () => {
  const reg = [
    entry("find-skills", { description: "locate a skill by keyword" }),
    entry("qmk-config", { description: "keyboard firmware config" }),
    entry("keyboard-shortcuts", { description: "unrelated" }),
  ];
  const noTags = new Map<string, string[]>();
  const noInstalled = new Set<string>();

  test("empty search with no other filters passes everything through", () => {
    expect(
      applyFilters(reg, "", [], false, noInstalled, noTags).map((e) => e.name),
    ).toEqual(reg.map((e) => e.name));
  });

  test("search matches name, case-insensitively", () => {
    expect(
      applyFilters(reg, "QMK", [], false, noInstalled, noTags).map(
        (e) => e.name,
      ),
    ).toEqual(["qmk-config"]);
  });

  test("search matches description when name doesn't match", () => {
    expect(
      applyFilters(reg, "firmware", [], false, noInstalled, noTags).map(
        (e) => e.name,
      ),
    ).toEqual(["qmk-config"]);
  });

  test("search matches effective tags", () => {
    const tags = new Map([["keyboard-shortcuts", ["hotkeys"]]]);
    expect(
      applyFilters(reg, "hotkeys", [], false, noInstalled, tags).map(
        (e) => e.name,
      ),
    ).toEqual(["keyboard-shortcuts"]);
  });

  test("installedOnly excludes entries not in installedNames", () => {
    const installed = new Set(["qmk-config"]);
    expect(
      applyFilters(reg, "", [], true, installed, noTags).map((e) => e.name),
    ).toEqual(["qmk-config"]);
  });

  test("selectedTags requires at least one match (OR across selected tags)", () => {
    const tags = new Map([
      ["find-skills", ["search"]],
      ["qmk-config", ["keyboard", "firmware"]],
      ["keyboard-shortcuts", ["keyboard"]],
    ]);
    expect(
      applyFilters(
        reg,
        "",
        ["firmware", "search"],
        false,
        noInstalled,
        tags,
      ).map((e) => e.name),
    ).toEqual(["find-skills", "qmk-config"]);
  });

  test("search and installedOnly compose (AND)", () => {
    const installed = new Set(["qmk-config", "keyboard-shortcuts"]);
    expect(
      applyFilters(reg, "keyboard", [], true, installed, noTags).map(
        (e) => e.name,
      ),
    ).toEqual(["qmk-config", "keyboard-shortcuts"]);
  });
});

describe("floatToTop", () => {
  test("moves matching entries to the front, preserving relative order", () => {
    const reg = [entry("a"), entry("b"), entry("c"), entry("d")];
    const out = floatToTop(reg, (e) => e.name === "b" || e.name === "d");
    expect(out.map((e) => e.name)).toEqual(["b", "d", "a", "c"]);
  });

  test("no matches leaves order unchanged", () => {
    const reg = [entry("a"), entry("b")];
    expect(floatToTop(reg, () => false).map((e) => e.name)).toEqual(["a", "b"]);
  });
});
