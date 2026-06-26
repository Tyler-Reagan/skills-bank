import os from "node:os";

/**
 * Effective home for the current run. Returns the dev-isolation
 * override when SKILLS_BANK_HOME_OVERRIDE is set (packaged dev runs),
 * otherwise the real OS home. Use this wherever a path should be
 * redirected into ~/.skills-bank-dev/ during unpackaged runs.
 */
export function getIsolatedHome(): string {
  return process.env.SKILLS_BANK_HOME_OVERRIDE ?? os.homedir();
}

/**
 * Real OS home, regardless of isolation. Use ONLY for intentional
 * real-path carveouts: the skills CLI lock file, Claude settings,
 * and the metrics directory — places that must reach the user's
 * actual files even when the app is running unpackaged.
 */
export function getRealHome(): string {
  return os.homedir();
}
