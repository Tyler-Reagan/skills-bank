import { buildRegistryIndex } from "../registry/build.js";
import { invalidateCanonCache } from "../registry/canon.js";
import { walkSkills } from "../registry/walk.js";
import { type LabelsMap } from "../registry/labels.js";
import { type RegistryManifest } from "./manifest.js";
import {
  importRegistryManifest,
  type ManifestImportProgressEvent,
} from "./import.js";

/**
 * Local skills absent from `manifest` — the deletion candidates for a
 * reconcile. Pure set diff; the caller decides whether to act on them
 * (the confirmed-removal arm) or surface them for confirmation.
 */
export function computeManifestRemovals(
  localNames: string[],
  manifest: RegistryManifest,
): string[] {
  const keep = new Set(manifest.skills.map((s) => s.name));
  return localNames.filter((n) => !keep.has(n));
}

export interface ReconcileResult {
  /** Local skills actually removed to propagate manifest deletions. */
  removed: string[];
  /**
   * Label overrides the import reconstructed from the manifest. The
   * caller (desktop main) persists these into the app's `labels.json`,
   * which lives outside the registry root — so reconcile returns them
   * rather than writing them itself.
   */
  restoredLabels?: LabelsMap;
}

/**
 * Make the local registry match `manifest`: import adds/updates, delete
 * the skills the manifest no longer lists (`localNames − manifestNames`,
 * which captures both confirmed and auto-resolved deletions), then
 * rebuild the index and invalidate the canon cache. The complete
 * "reconcile local to this manifest" op. The caller owns the merge-base
 * advance and persisting `restoredLabels`.
 */
export async function reconcileRegistryToManifest(
  registryRoot: string,
  manifest: RegistryManifest,
  opts: {
    token?: string | null;
    onProgress?: (event: ManifestImportProgressEvent) => void;
  } = {},
): Promise<ReconcileResult> {
  const removeNames = computeManifestRemovals(
    walkSkills(registryRoot).map((r) => r.name),
    manifest,
  );
  const result = await importRegistryManifest(registryRoot, manifest, {
    ...(opts.token !== undefined ? { token: opts.token } : {}),
    ...(removeNames.length > 0 ? { removeNames } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });
  buildRegistryIndex(registryRoot, { includeGitInfo: true, writeFile: true });
  invalidateCanonCache(registryRoot);
  return {
    removed: (result.removed ?? []).filter((r) => r.ok).map((r) => r.name),
    ...(result.restoredLabels ? { restoredLabels: result.restoredLabels } : {}),
  };
}
