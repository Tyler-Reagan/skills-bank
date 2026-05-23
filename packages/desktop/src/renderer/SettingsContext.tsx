import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from "./components/SettingsModal.js";
import type { Density, Theme } from "./components/Header.js";

const LS_KEYS = {
  settings: "skills-bank.settings",
  theme: "skills-bank.theme",
  density: "skills-bank.density",
};

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEYS.settings);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(LS_KEYS.theme);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // fall through
  }
  // Honor OS preference for first run when nothing is stored.
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

function readInitialDensity(): Density {
  try {
    const stored = localStorage.getItem(LS_KEYS.density);
    if (stored === "compact" || stored === "comfortable") return stored;
  } catch {
    // fall through
  }
  return "comfortable";
}

interface SettingsContextValue {
  settings: AppSettings;
  saveSettings: (next: AppSettings) => void;
  theme: Theme;
  setTheme: (next: Theme) => void;
  density: Density;
  setDensity: (next: Density) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used inside <SettingsProvider>");
  }
  return ctx;
}

interface ProviderProps {
  children: React.ReactNode;
}

/**
 * Owns the AppSettings object + the two orthogonal preference scalars
 * (theme, density). All three are persisted to localStorage; the
 * provider also writes theme/density to `document.documentElement.dataset`
 * so the global CSS can style the page from the data attributes.
 *
 * Pulled out of App.tsx in the v1.12 housekeeping branch: previously
 * the settings state, the saveSettings callback, and the dataset write
 * effects all lived inline in the god-component. Every consumer that
 * needed settings had to receive them as a prop through DrawerHost /
 * BrowseTab / InstalledTab / etc. This context replaces all that
 * prop-drilling.
 */
export function SettingsProvider({
  children,
}: ProviderProps): React.ReactElement {
  const [settings, setSettingsState] = useState<AppSettings>(readSettings);
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);
  const [density, setDensityState] = useState<Density>(readInitialDensity);

  const saveSettings = useCallback((next: AppSettings) => {
    setSettingsState(next);
    try {
      localStorage.setItem(LS_KEYS.settings, JSON.stringify(next));
    } catch {
      // Storage quota / disabled — accept the in-memory update; the
      // persistence layer is best-effort.
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);
  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
  }, []);

  // Mirror theme + density onto the document root + localStorage.
  // CSS reads the dataset attributes to drive global theming; the LS
  // writes preserve the choice across launches.
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    try {
      localStorage.setItem(LS_KEYS.theme, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset["density"] = density;
    try {
      localStorage.setItem(LS_KEYS.density, density);
    } catch {
      // ignore
    }
  }, [density]);

  // Grid columns from settings also write to dataset. Kept here because
  // it's a derived effect of `settings`, mirroring the theme/density
  // pattern.
  useEffect(() => {
    document.documentElement.dataset["gridCols"] = settings.gridColumns;
  }, [settings.gridColumns]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, saveSettings, theme, setTheme, density, setDensity }),
    [settings, saveSettings, theme, setTheme, density, setDensity],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
