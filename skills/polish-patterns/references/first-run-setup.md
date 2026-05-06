# First-run setup screen with persisted preference

## Problem

A packaged Electron `.app` (or any standalone tool) often needs configuration the dev-only environment provided implicitly — a folder path, an API key, a server URL. The user shouldn't be dropped into a broken main UI; they should see a focused setup screen explaining what's needed and offering one clear action.

Implements `ui-ux-pro-max` §8 `progressive-disclosure`, `error-clarity`, `error-recovery`.

## Pattern

### Settings layer (Electron main process)

```ts
import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";

interface AppConfig {
  registryRoot: string | null;
}

function configFilePath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): AppConfig {
  const p = configFilePath();
  try {
    if (!fs.existsSync(p)) return { registryRoot: null };
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AppConfig>;
    return {
      registryRoot:
        typeof raw.registryRoot === "string" ? raw.registryRoot : null,
    };
  } catch {
    return { registryRoot: null };
  }
}

function writeConfig(cfg: AppConfig): void {
  const p = configFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

// Validate the chosen path. Return a structured reason on failure so the
// renderer can surface it inline.
function isValidRegistryRoot(candidate: string): { ok: boolean; reason?: string } {
  if (!candidate) return { ok: false, reason: "empty path" };
  if (!fs.existsSync(candidate)) {
    return { ok: false, reason: `path does not exist: ${candidate}` };
  }
  const pkgPath = path.join(candidate, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, reason: "no package.json in this folder" };
  }
  // …more checks…
  return { ok: true };
}
```

### IPC

```ts
ipcMain.handle("getConfig", () => ({
  registryRoot,
  configValid: registryRoot !== null,
  isPackaged: app.isPackaged,
}));

ipcMain.handle("setRegistryRoot", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: "Choose your skills-bank repo folder",
    message: "Pick the folder you cloned (must contain package.json with name 'skills-bank' and a skills/ directory).",
    properties: ["openDirectory"],
    defaultPath: registryRoot ?? app.getPath("home"),
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, message: "cancelled", registryRoot };
  }
  const candidate = result.filePaths[0]!;
  const validation = isValidRegistryRoot(candidate);
  if (!validation.ok) {
    return { ok: false, message: validation.reason ?? "invalid folder", registryRoot };
  }
  registryRoot = candidate;
  writeConfig({ registryRoot: candidate });
  return { ok: true, message: `registry set to ${candidate}`, registryRoot };
});
```

### Setup screen (renderer)

```tsx
export function SetupScreen({ onConfigured }: { onConfigured: (root: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await window.skillsBank.setRegistryRoot();
      if (r.ok && r.registryRoot) {
        onConfigured(r.registryRoot);
      } else if (r.message !== "cancelled") {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-brand">skills<span>-</span>bank</div>
        <h1>Welcome — pick your registry folder.</h1>
        <p>
          skills-bank manages skills that live inside a cloned git repo on
          your machine. To get started, point this app at the folder where
          you cloned <code>skills-bank</code>.
        </p>
        <p className="setup-hint">
          The folder must contain a <code>package.json</code> whose name is
          <code>"skills-bank"</code> and a <code>skills/</code> subdirectory.
        </p>
        <button className="btn primary setup-cta" onClick={pick} disabled={busy}>
          {busy ? <><span className="spinner inline" /> Choosing folder…</>
                : <><Icon name="folder" /> Choose registry folder…</>}
        </button>
        {error && (
          <p className="setup-error" role="alert">
            <Icon name="alert-triangle" size="sm" /> {error}
          </p>
        )}
        <p className="setup-footnote">
          Don&apos;t have it cloned? Run <code>git clone …</code> in Terminal first.
        </p>
      </div>
    </div>
  );
}
```

### App routing

```tsx
const refresh = useCallback(async () => {
  const cfg = await window.skillsBank.getConfig();
  setRegistryRoot(cfg.registryRoot);
  setConfigChecked(true);
  /* … */
}, []);

if (initialLoading) return <SkeletonChrome />;
if (configChecked && !registryRoot) {
  return <SetupScreen onConfigured={() => refresh()} />;
}
return <MainUI />;
```

### Re-pick later (Settings button)

The same picker IPC, called from a gear button in the Header. Accept that the user might re-point during normal use; treat it the same as a fresh setup.

## Gotchas

- **Validate in the main process, not the renderer.** Filesystem checks should run where they don't need IPC round-trips and where errors can be structured (`ok: false, reason: "…"`) cleanly.
- **Don't fail silently on validation.** "That's not the right folder" with no detail is worse than no error. Surface the *specific* reason inline (`no package.json`, `wrong name in package.json`, etc.).
- **Cancel is not an error.** When the user cancels the file picker, return `{ ok: false, message: "cancelled" }` and the renderer should NOT show an error — just stay on the setup screen.
- **Persist immediately, not on "Save".** A separate save step adds friction. The validate→pick→persist→navigate happens in one IPC call.
- **Boot resolution order matters.** Check persisted config *first*, then env var (`SKILLS_BANK_ROOT`), then fall back to a dev-friendly cwd walk-up. The walk-up is dev-only and should never succeed for a packaged app.
- **`app.getPath("userData")` is the right home for `config.json`.** On macOS that's `~/Library/Application Support/<appName>/`. Don't write to the app bundle's Resources dir — read-only on mac and stripped on update.
- **Nullable registry root.** Once you accept "not configured" as a valid state, every IPC handler that uses `registryRoot` needs a null guard. Reads should return empty values; writes should return `{ ok: false, message: "Registry folder not configured…" }`.

## See also

- [inline-validation](inline-validation.md) — the inline-error-with-aria-alert pattern is the same shape used in the setup screen.
- [empty-states](empty-states.md) — same single-action empty-state philosophy.
