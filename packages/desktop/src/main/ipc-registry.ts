import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  adoptableInstalledNames,
  adoptableNpxSkills,
  adoptNpxSkill,
  AGENTS,
  applyRegistration,
  buildRegistryIndex,
  classifySkillByName,
  deleteUnregisteredSkill,
  dismissUnregisterFailure,
  purgeSkillFromRegistry,
  detachOrigin,
  extractSkill,
  findSkillFolder,
  folderPathFromSkillPath,
  forgetMissingEntry,
  fromCaught,
  getAgent,
  getAgentSkillsDir,
  getDefaultInstallAgents,
  getExtractInfo,
  hashSkillFolder,
  installSkillFiles,
  isGithubUrl,
  linkSkillToAgents,
  listClaudePluginSkills,
  listInstalled,
  makeAppError,
  parseGithubSkillUrl,
  parseNpxSkillsAdd,
  parseOwnerRepo,
  readLiveManifest,
  readNpxLock,
  readSkillMeta,
  removeBrokenLinks,
  repairBrokenLinks,
  repointOrigin as coreRepointOrigin,
  resolveSkillConflicts,
  resolveSkillFolderByName,
  scanExistingInstalls,
  setRuntimeEntry,
  unregisterSkill,
  unlinkSkillFromAgents,
  writeLiveManifest,
  rehomeIntoLinkedRepo as coreRehomeIntoLinkedRepo,
  type AgentId,
  type InstalledKind,
  type ManifestSkill,
  type RegistrationAction,
} from "@skills-bank/core";

import { getStoredToken } from "./auth.js";
import {
  augmentWithProbedUpdates,
  getLinkedRepo,
  getRegistryRoot,
  mutatingHandle,
  NO_ROOT_MSG,
  notifyProbeComplete,
  probedUpdates,
  runUpstreamProbe,
  setRegistryRoot,
  persistConfig,
} from "./main-state.js";
import { IPC } from "../shared/ipc.js";
import { isSafeExternalUrl } from "./ipc-shell.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidRegistryRoot(candidate: string): {
  ok: boolean;
  reason?: string;
} {
  if (!candidate) return { ok: false, reason: "empty path" };
  if (!fs.existsSync(candidate)) {
    return { ok: false, reason: `path does not exist: ${candidate}` };
  }
  if (!fs.statSync(candidate).isDirectory()) {
    return { ok: false, reason: `not a directory: ${candidate}` };
  }
  return { ok: true };
}

function suspiciousPathWarning(candidate: string): string | null {
  const normalized = path.resolve(candidate);
  const home = app.getPath("home");
  if (normalized === path.parse(normalized).root) {
    return `${normalized} is the filesystem root — did you mean a subfolder?`;
  }
  if (normalized === path.resolve(home)) {
    return `${normalized} is your home directory — registry roots typically live in a subfolder (e.g. ~/Projects/skills-bank).`;
  }
  const systemRoots = ["/usr", "/etc", "/var", "/bin", "/sbin", "/opt"];
  for (const sys of systemRoots) {
    if (normalized === sys) {
      return `${normalized} is a system directory — registry roots should be a project folder.`;
    }
  }
  return null;
}

function allowedRevealRoots(): string[] {
  const roots: string[] = [];
  const registryRoot = getRegistryRoot();
  if (registryRoot) roots.push(path.resolve(registryRoot));
  for (const agent of AGENTS) {
    try {
      const dir = getAgentSkillsDir(agent);
      if (dir) roots.push(path.resolve(dir));
    } catch {
      // Ignore agents that aren't configured on this host.
    }
  }
  return roots;
}

function isInsideAnyRoot(candidate: string, roots: string[]): boolean {
  const normalized = path.resolve(candidate);
  for (const root of roots) {
    const rel = path.relative(root, normalized);
    if (rel === "") return true;
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
}

// Read up to 8 KB of SKILL.md text.
function readSkillMdText(skillMdPath: string): string | null {
  if (!fs.existsSync(skillMdPath)) return null;
  const fd = fs.openSync(skillMdPath, "r");
  try {
    const buf = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buf, 0, 8192, 0);
    const total = fs.statSync(skillMdPath).size;
    const text = buf.subarray(0, bytes).toString("utf8");
    return total > bytes ? text + "\n\n(truncated)" : text;
  } finally {
    fs.closeSync(fd);
  }
}

// ─── Register handlers ────────────────────────────────────────────────────────

export function registerRegistryHandlers(): void {
  ipcMain.handle(IPC.getRoot, () => getRegistryRoot());

  ipcMain.handle(IPC.dismissWeakStorageNotice, () => {
    const { getStorageBackend } =
      require("./auth.js") as typeof import("./auth.js");
    const backend = getStorageBackend();
    if (!backend) return;
    const { readConfig, writeConfig } =
      require("./main-state.js") as typeof import("./main-state.js");
    const cfg = readConfig();
    if (!cfg.weakStorageNoticeDismissedFor.includes(backend)) {
      cfg.weakStorageNoticeDismissedFor = [
        ...cfg.weakStorageNoticeDismissedFor,
        backend,
      ];
      writeConfig(cfg);
    }
  });

  ipcMain.handle(IPC.setRegistryRoot, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const registryRoot = getRegistryRoot();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Choose your skills-bank repo folder",
      message:
        "Pick the skills-bank folder you cloned (must contain package.json with name 'skills-bank' and a skills/ directory).",
      properties: ["openDirectory"],
      defaultPath: registryRoot ?? app.getPath("home"),
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: "cancelled", registryRoot };
    }
    const candidate = result.filePaths[0]!;
    const validation = isValidRegistryRoot(candidate);
    if (!validation.ok) {
      return {
        ok: false,
        message: validation.reason ?? "invalid folder",
        registryRoot,
      };
    }
    setRegistryRoot(candidate);
    persistConfig();
    const warning = suspiciousPathWarning(candidate);
    return {
      ok: true,
      message: `registry set to ${candidate}`,
      registryRoot: candidate,
      ...(warning ? { warning } : {}),
    };
  });

  ipcMain.handle(IPC.listRegistry, () => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return [];
    return augmentWithProbedUpdates(buildRegistryIndex(registryRoot).entries);
  });

  // The "installed via npx, not yet in the registry" set (issue #192).
  // A read, invoked when the user opens the Discover tab — never a boot
  // sweep (auto-adopt would silently dismantle npx's canonical store).
  // skills-bank only ever reads npx's lockfile; it never writes it.
  ipcMain.handle(IPC.discoverNpxSkills, () => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return [];
    const existing = buildRegistryIndex(registryRoot).entries.map(
      (e) => e.name,
    );
    // Only surface skills that actually exist on disk as adoptable content —
    // a stale npx lockfile row (skill npx recorded but no longer installed
    // here) would otherwise list as adoptable and then fail adoption.
    const onDisk = adoptableInstalledNames(scanExistingInstalls(registryRoot));
    return adoptableNpxSkills(readNpxLock(), existing, onDisk);
  });

  // Adopt one npx-installed skill into the registry (issue #193). A
  // mutatingHandle: the register move-in + link sever happen in the body,
  // and the finally's snapshotAfterMutation → reconcile backfills the
  // origin from npx's lockfile by name (#191). That reconcile IS the
  // cross-machine hinge — it turns the moved-in orphan into a portable
  // manifest row that re-fetches on another machine with no npx present.
  mutatingHandle(IPC.adoptNpxSkill, (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
    return adoptNpxSkill(registryRoot, name);
  });

  // Skills exposed by installed Claude Code plugins — read-only,
  // informational only (no adopt path). skills-bank never touches any
  // plugin state; this just reads Claude Code's own installed_plugins.json
  // + each plugin's plugin.json fresh on every call, same as the npx read
  // above — invoked on Discover tab mount, never a boot sweep.
  ipcMain.handle(IPC.discoverClaudePluginSkills, () => {
    return listClaudePluginSkills();
  });

  ipcMain.handle(IPC.listInstalled, () => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot)
      return listInstalled("", {
        index: { generatedAt: "", entries: [] },
      });
    const index = buildRegistryIndex(registryRoot);
    return listInstalled(registryRoot, { index });
  });

  mutatingHandle(
    IPC.install,
    async (_e, name: string, force?: boolean, agents?: AgentId[]) => {
      const registryRoot = getRegistryRoot();
      if (!registryRoot) return { ok: false, message: NO_ROOT_MSG, errors: [] };
      try {
        const found = findSkillFolder(registryRoot, name);
        if (!found) throw new Error(`Skill "${name}" not found in registry.`);
        const skillPath = found.dir;
        const manifest = readLiveManifest(registryRoot);
        const row = manifest.skills.find((s) => s.name === name);
        const origin = row?.origin;
        const repo = origin ? parseOwnerRepo(origin.url) : null;

        if (origin && isGithubUrl(origin.url) && repo && origin.skillPath) {
          await installSkillFiles(
            repo,
            folderPathFromSkillPath(origin.skillPath),
            skillPath,
            getStoredToken(),
          );
        }

        const targetAgents =
          agents && agents.length > 0
            ? agents.map(getAgent)
            : getDefaultInstallAgents();
        const r = linkSkillToAgents(skillPath, targetAgents, {
          force: force ?? false,
        });
        const wrote = r.installs.filter((i) => !i.alreadyInstalled);
        if (wrote.length > 0) {
          return {
            ok: true,
            message: `installed ${name} for ${wrote.length} agent(s)`,
            errors: r.errors,
          };
        }
        if (r.installs.length > 0) {
          return {
            ok: true,
            message: `${name} already installed`,
            errors: r.errors,
          };
        }
        return {
          ok: false,
          message: r.errors[0]?.message ?? `nothing installed for ${name}`,
          errors: r.errors,
        };
      } catch (err) {
        return (() => {
          const error = fromCaught("ipc.unknown", err);
          return { ok: false, message: error.message, error, errors: [] };
        })();
      }
    },
  );

  mutatingHandle(IPC.forgetMissing, (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
    try {
      const r = forgetMissingEntry(registryRoot, name);
      buildRegistryIndex(registryRoot, {
        includeGitInfo: true,
        writeFile: true,
      });
      return r;
    } catch (err) {
      return (() => {
        const error = fromCaught("ipc.unknown", err);
        return { ok: false, message: error.message, error };
      })();
    }
  });

  mutatingHandle(IPC.dismissUnregisterFailure, (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return { ok: false };
    dismissUnregisterFailure(registryRoot, name);
    buildRegistryIndex(registryRoot, { includeGitInfo: true, writeFile: true });
    return { ok: true };
  });

  mutatingHandle(IPC.repointOrigin, async (_e, name: string, url: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
    const parsed = parseGithubSkillUrl(url);
    if ("kind" in parsed) {
      return { ok: false, message: parsed.message };
    }
    try {
      const r = await coreRepointOrigin(
        registryRoot,
        name,
        { repo: parsed.repo, skillPath: parsed.skillPath },
        getStoredToken(),
      );
      if (r.ok) {
        probedUpdates.delete(name);
        notifyProbeComplete();
        buildRegistryIndex(registryRoot, {
          includeGitInfo: true,
          writeFile: true,
        });
      }
      return r;
    } catch (err) {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    }
  });

  mutatingHandle(IPC.detachLocal, (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
    try {
      const r = detachOrigin(registryRoot, name);
      if (r.ok) {
        probedUpdates.delete(name);
        notifyProbeComplete();
        buildRegistryIndex(registryRoot, {
          includeGitInfo: true,
          writeFile: true,
        });
      }
      return { ok: r.ok, message: r.message };
    } catch (err) {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    }
  });

  mutatingHandle(
    IPC.rehomeIntoLinkedRepo,
    async (_e, name: string, destPath: string) => {
      const registryRoot = getRegistryRoot();
      const linkedRepo = getLinkedRepo();
      if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
      if (!linkedRepo) return { ok: false, message: "no linked repo" };
      const token = getStoredToken();
      if (!token) return { ok: false, message: "not authenticated" };
      try {
        const detached = detachOrigin(registryRoot, name);
        if (!detached.ok) return { ok: false, message: detached.message };
        const r = await coreRehomeIntoLinkedRepo({
          registryRoot,
          name,
          linkedRepo: linkedRepo.fullName,
          baseBranch: linkedRepo.defaultBranch ?? "main",
          destPath,
          token,
        });
        buildRegistryIndex(registryRoot, {
          includeGitInfo: true,
          writeFile: true,
        });
        return r.ok
          ? {
              ok: true,
              message: `Opened PR #${r.prNumber}`,
              prNumber: r.prNumber,
              htmlUrl: r.htmlUrl,
            }
          : { ok: false, message: r.message, rateLimit: r.rateLimit };
      } catch (err) {
        const error = fromCaught("ipc.unknown", err);
        return { ok: false, message: error.message, error };
      }
    },
  );

  mutatingHandle(IPC.deleteUnregistered, (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) {
      return {
        ok: false,
        message: NO_ROOT_MSG,
        removedDirs: [],
        removedSymlinks: [],
      };
    }
    try {
      const r = deleteUnregisteredSkill(registryRoot, name);
      return {
        ok: r.ok,
        message: r.message,
        removedDirs: r.removedDirs,
        removedSymlinks: r.removedSymlinks,
      };
    } catch (err) {
      const error = fromCaught("delete-unregistered.unknown", err);
      return {
        ok: false,
        message: error.message,
        error,
        removedDirs: [],
        removedSymlinks: [],
      };
    }
  });

  mutatingHandle(
    IPC.unregister,
    (_e, name: string, destination: AgentId, force?: boolean) => {
      const registryRoot = getRegistryRoot();
      if (!registryRoot) {
        const error = makeAppError({
          code: "config.no-registry-root",
          message: NO_ROOT_MSG,
        });
        return {
          ok: false,
          message: NO_ROOT_MSG,
          errors: [error],
          error,
        };
      }
      const classification = classifySkillByName(registryRoot, name);
      if (classification && !classification.capabilities.canUnregister) {
        const error = makeAppError({
          code: "unregister.not-allowed-from-state",
          message: `Cannot unregister ${name} from this state (${classification.state}).`,
          copyableDetails: { name, state: classification.state },
        });
        return {
          ok: false,
          message: error.message,
          errors: [error],
          error,
        };
      }
      try {
        const r = unregisterSkill(name, {
          registryRoot,
          destination,
          force: force ?? false,
        });
        return {
          ok: r.ok,
          message: r.message,
          destinationPath: r.destinationPath,
          errors: r.errors,
          error: r.error,
        };
      } catch (err) {
        const error = fromCaught("unregister.unknown", err);
        return {
          ok: false,
          message: error.message,
          errors: [error],
          error,
        };
      }
    },
  );

  mutatingHandle(IPC.removeFromRegistry, (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) {
      const error = makeAppError({
        code: "config.no-registry-root",
        message: NO_ROOT_MSG,
      });
      return { ok: false, message: NO_ROOT_MSG, errors: [error], error };
    }
    try {
      const r = purgeSkillFromRegistry(registryRoot, name);
      return {
        ok: r.ok,
        message: r.message,
        errors: r.error ? [r.error] : [],
        error: r.error,
      };
    } catch (err) {
      const error = fromCaught("remove-from-registry.unknown", err);
      return { ok: false, message: error.message, errors: [error], error };
    }
  });

  mutatingHandle(IPC.uninstall, (_e, name: string, agents?: AgentId[]) => {
    try {
      const r = unlinkSkillFromAgents(
        name,
        agents && agents.length > 0 ? { agents } : {},
      );
      const removedCount = r.removals.filter((x) => x.removed).length;
      const keptCount = r.errors.length;
      const message =
        keptCount === 0
          ? r.removed
            ? `Removed ${name} from ${removedCount} agent dir(s).`
            : `${name} not installed`
          : `Removed from ${removedCount} agent(s); ${keptCount} kept (not symlinks)`;
      return {
        ok: true,
        message,
        errors: r.errors,
        removedCount,
        keptCount,
      };
    } catch (err) {
      return (() => {
        const error = fromCaught("ipc.unknown", err);
        return { ok: false, message: error.message, error, errors: [] };
      })();
    }
  });

  ipcMain.handle(IPC.scan, () => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) {
      return {
        agentDirs: {},
        registryRoot: "",
        entries: [],
      };
    }
    return scanExistingInstalls(registryRoot);
  });

  mutatingHandle(
    IPC.register,
    (_e, items: Array<{ name: string; action: RegistrationAction }>) => {
      const registryRoot = getRegistryRoot();
      if (!registryRoot) {
        return items.map(({ action }) => ({
          action,
          ok: false,
          message: NO_ROOT_MSG,
        }));
      }
      const report = scanExistingInstalls(registryRoot);
      const kindRank: Record<InstalledKind, number> = {
        "real-directory": 4,
        ours: 3,
        "foreign-symlink": 2,
        "broken-symlink": 1,
      };
      const byName = new Map<string, (typeof report.entries)[number]>();
      for (const e of report.entries) {
        const existing = byName.get(e.name);
        if (!existing || kindRank[e.kind] > kindRank[existing.kind]) {
          byName.set(e.name, e);
        }
      }
      const findEntry = (
        name: string,
        target: { agent?: string },
      ): (typeof report.entries)[number] | undefined => {
        if (target.agent === undefined) return byName.get(name);
        return report.entries.find(
          (e) => e.name === name && e.agent === target.agent,
        );
      };
      return items.map(({ name, action }) => {
        const target =
          action.type === "setAgents" ? {} : { agent: action.agent };
        const entry = findEntry(name, target);
        if (!entry) {
          return {
            action,
            ok: false,
            message: `entry ${name} not found in scan`,
          };
        }
        return applyRegistration(entry, action, {
          registryRoot: registryRoot!,
          confirmDestructive: true,
        });
      });
    },
  );

  mutatingHandle(IPC.rebuildIndex, () => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG, entries: 0 };
    try {
      const index = buildRegistryIndex(registryRoot, {
        includeGitInfo: true,
        writeFile: true,
      });
      void runUpstreamProbe();
      return {
        ok: true,
        message: `index rebuilt (${index.entries.length} entries)`,
        entries: index.entries.length,
      };
    } catch (err) {
      const error = fromCaught("rebuild-index.unknown", err);
      return {
        ok: false,
        message: error.message,
        error,
        entries: 0,
      };
    }
  });

  ipcMain.handle(IPC.extractInfo, (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) throw new Error(NO_ROOT_MSG);
    return getExtractInfo(registryRoot, name);
  });

  ipcMain.handle(IPC.extractSkill, async (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
    try {
      const info = getExtractInfo(registryRoot, name);
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win ?? undefined!, {
        title: `Extract ${name}`,
        defaultPath: info.suggestedFilename,
        filters:
          info.kind === "standalone"
            ? [{ name: "Markdown", extensions: ["md"] }]
            : [{ name: "Zip Archive", extensions: ["zip"] }],
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, message: "extract cancelled" };
      }
      const r = await extractSkill(registryRoot, name, result.filePath);
      return {
        ok: true,
        message: `extracted ${name} (${r.kind}) → ${r.destPath}`,
        result: r,
      };
    } catch (err) {
      return (() => {
        const error = fromCaught("ipc.unknown", err);
        return { ok: false, message: error.message, error };
      })();
    }
  });

  ipcMain.handle(IPC.readSkillMd, (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return null;
    try {
      const index = buildRegistryIndex(registryRoot);
      const entry = index.entries.find((x) => x.name === name);
      if (entry) {
        const fromRegistry = readSkillMdText(
          path.join(registryRoot, entry.path, "SKILL.md"),
        );
        if (fromRegistry !== null) return fromRegistry;
      }
      for (const agent of AGENTS) {
        const candidate = path.join(getAgentSkillsDir(agent), name, "SKILL.md");
        const text = readSkillMdText(candidate);
        if (text !== null) return text;
      }
      return null;
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC.openInFinder, async (_e, absolutePath: string) => {
    if (typeof absolutePath !== "string" || absolutePath.length === 0) {
      return;
    }
    if (!path.isAbsolute(absolutePath)) return;
    if (!isInsideAnyRoot(absolutePath, allowedRevealRoots())) {
      console.warn(
        `openInFinder: refused path outside allowlist: ${absolutePath}`,
      );
      return;
    }
    await shell.openPath(absolutePath);
  });

  ipcMain.handle(IPC.repairBrokenLinks, (_e, name: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot)
      return {
        repaired: [],
        unrepairable: [{ agent: "claude", linkPath: "", reason: NO_ROOT_MSG }],
      };
    return repairBrokenLinks(registryRoot, name);
  });

  mutatingHandle(
    IPC.removeBrokenLinks,
    (_e, name: string, agents: AgentId[]) => {
      const registryRoot = getRegistryRoot();
      if (!registryRoot)
        return {
          removed: [],
          errors: [{ agent: "claude", message: NO_ROOT_MSG }],
        };
      return removeBrokenLinks(registryRoot, name, agents);
    },
  );

  mutatingHandle(
    IPC.resolveSkillConflicts,
    (
      _e,
      name: string,
      decisions: import("@skills-bank/core").ConflictResolveDecision[],
    ) => {
      const registryRoot = getRegistryRoot();
      if (!registryRoot) {
        return {
          applied: [],
          errors: decisions.map((d) => ({
            agent: d.agent,
            action: d.action,
            message: NO_ROOT_MSG,
          })),
        };
      }
      return resolveSkillConflicts(registryRoot, name, decisions);
    },
  );

  // Discover tab: install-from-GitHub. `input` is either a GitHub
  // folder/blob URL or an `npx skills add <repo> --skill <name>` command.
  mutatingHandle(IPC.addFromGithub, async (_e, input: string) => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) {
      return {
        ok: false,
        reason: "mirror-failed",
        message: NO_ROOT_MSG,
      } as const;
    }

    // Resolve the input to a concrete { repo, skillPath }. The npx-command
    // form only carries a skill *name*, so its folder is found by searching
    // the repo tree here in the main process (needs the GitHub token) — real
    // npx does the same crawl, which is why it succeeds where the old
    // renderer-side `skills/<name>` guess 404'd.
    let repo: string;
    let skillPath: string;
    const npx = parseNpxSkillsAdd(input);
    if (npx) {
      const resolved = await resolveSkillFolderByName(
        npx.repo,
        npx.skillName,
        getStoredToken(),
      );
      if (!resolved.ok) {
        return {
          ok: false,
          reason: "skill-resolve-error",
          message: resolved.message,
          candidates: resolved.candidates,
          rateLimit: resolved.rateLimit,
        } as const;
      }
      repo = npx.repo;
      skillPath = resolved.skillPath;
    } else {
      const parsed = parseGithubSkillUrl(input);
      if ("kind" in parsed) {
        return {
          ok: false,
          reason: "url-parse-error",
          message: parsed.message,
        } as const;
      }
      repo = parsed.repo;
      skillPath = parsed.skillPath;
    }

    const folderPath = folderPathFromSkillPath(skillPath);
    const provisionalName =
      folderPath.split("/").filter(Boolean).pop() ?? "skill";
    const destDir = path.join(
      registryRoot,
      "skills",
      "vendored",
      provisionalName,
    );

    // Refuse before writing anything if this name already lives in the
    // OTHER bucket — walkSkills enforces global name uniqueness across
    // buckets, and mirroring into vendored/ on top of an existing
    // personal/ folder of the same name corrupts the registry (the
    // next reconcile/boot can no longer walk skills/ at all).
    const preExisting = findSkillFolder(registryRoot, provisionalName);
    if (preExisting && preExisting.bucket !== "vendored") {
      return {
        ok: false,
        reason: "name-collision",
        message: `A skill named "${provisionalName}" already exists in your ${preExisting.bucket} skills. Remove or rename it before adding this one from GitHub.`,
      } as const;
    }

    let mirror: Awaited<ReturnType<typeof installSkillFiles>>;
    try {
      mirror = await installSkillFiles(
        repo,
        folderPath,
        destDir,
        getStoredToken(),
      );
    } catch (err) {
      return {
        ok: false,
        reason: "mirror-failed",
        message:
          err instanceof Error
            ? err.message
            : "Unexpected error during install.",
      } as const;
    }
    if (!mirror.ok) {
      return {
        ok: false,
        reason: "mirror-failed",
        message: mirror.message,
        rateLimit: mirror.rateLimit,
      } as const;
    }

    const meta = readSkillMeta(destDir);
    if (!meta) {
      fs.rmSync(destDir, { recursive: true, force: true });
      return {
        ok: false,
        reason: "no-skill-md",
        message: `${repo}/${folderPath} doesn't contain a SKILL.md with frontmatter.`,
      } as const;
    }

    let finalDir = destDir;
    let finalName = provisionalName;
    if (meta.name && meta.name !== provisionalName) {
      // The frontmatter name differs from the folder name we mirrored
      // under — re-check the collision guard against the TRUE final
      // name before renaming onto it.
      const renameCollision = findSkillFolder(registryRoot, meta.name);
      if (renameCollision && renameCollision.bucket !== "vendored") {
        fs.rmSync(destDir, { recursive: true, force: true });
        return {
          ok: false,
          reason: "name-collision",
          message: `A skill named "${meta.name}" already exists in your ${renameCollision.bucket} skills. Remove or rename it before adding this one from GitHub.`,
        } as const;
      }
      const canonDest = path.join(
        registryRoot,
        "skills",
        "vendored",
        meta.name,
      );
      fs.renameSync(destDir, canonDest);
      finalDir = canonDest;
      finalName = meta.name;
    }

    // Stamp the manifest row with the mirrored origin + hash, and
    // baseline the runtime map's synced hash (ADR-0020/0021 — no more
    // per-skill sidecars).
    const manifest = readLiveManifest(registryRoot);
    const row: ManifestSkill = {
      name: finalName,
      origin: {
        url: `https://github.com/${repo}`,
        skillPath: skillPath,
        hash: mirror.folderHash,
      },
      category: null,
      tags: [],
    };
    const idx = manifest.skills.findIndex((s) => s.name === finalName);
    if (idx >= 0) manifest.skills[idx] = row;
    else manifest.skills.push(row);
    writeLiveManifest(registryRoot, manifest);
    const baseline = hashSkillFolder(finalDir);
    if (baseline)
      setRuntimeEntry(registryRoot, finalName, { syncedHash: baseline });

    linkSkillToAgents(finalDir, getDefaultInstallAgents(), { force: false });

    return { ok: true, name: finalName } as const;
  });
}
