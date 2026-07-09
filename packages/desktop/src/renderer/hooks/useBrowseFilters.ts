import { useState } from "react";
import type { RegistrySortState } from "../components/browseFilters.js";

const LS_KEYS = {
  search: "skills-bank.searchQuery",
  tagFilter: "skills-bank.tagFilter",
  installedOnly: "skills-bank.installedOnly",
};

function readLS(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota/disabled
  }
}

function readTagFilterLS(): string[] {
  try {
    const raw = readLS(LS_KEYS.tagFilter, "[]");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export interface BrowseFilters {
  search: string;
  setSearch: (v: string) => void;
  selectedTags: string[];
  setSelectedTags: (next: string[]) => void;
  installedOnly: boolean;
  setInstalledOnly: (v: boolean) => void;
  registrySort: RegistrySortState;
  setRegistrySort: (next: RegistrySortState) => void;
}

/**
 * Owns the BrowseTab filter state + localStorage persistence for
 * search, selectedTags, and installedOnly. registrySort is session-
 * only (intentionally not persisted — stale sort state from a prior
 * session is rarely useful). registryFilters is excluded because the
 * Rescan controller flips it remotely; that slice stays in App.tsx.
 */
export function useBrowseFilters(): BrowseFilters {
  const [search, setSearchState] = useState<string>(() =>
    readLS(LS_KEYS.search, ""),
  );
  const [installedOnly, setInstalledOnlyState] = useState<boolean>(
    () => readLS(LS_KEYS.installedOnly, "false") === "true",
  );
  const [selectedTags, setSelectedTagsState] =
    useState<string[]>(readTagFilterLS);
  const [registrySort, setRegistrySort] = useState<RegistrySortState>({
    by: "name",
    direction: "asc",
  });

  const setSearch = (v: string) => {
    setSearchState(v);
    writeLS(LS_KEYS.search, v);
  };

  const setSelectedTags = (next: string[]) => {
    setSelectedTagsState(next);
    writeLS(LS_KEYS.tagFilter, JSON.stringify(next));
  };

  const setInstalledOnly = (v: boolean) => {
    setInstalledOnlyState(v);
    writeLS(LS_KEYS.installedOnly, String(v));
  };

  return {
    search,
    setSearch,
    selectedTags,
    setSelectedTags,
    installedOnly,
    setInstalledOnly,
    registrySort,
    setRegistrySort,
  };
}
