import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  GITHUB_CLIENT_ID,
  GITHUB_SCOPE,
  isAuthConfigured,
} from "./auth-config.js";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_API = "https://api.github.com/user";
const USER_AGENT = "skills-bank";

export interface DeviceFlowStart {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  /** Opaque handle the renderer passes back to cancel polling. */
  flowId: string;
}

export interface GitHubUser {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
}

export class DeviceFlowError extends Error {
  constructor(
    public code:
      | "denied"
      | "expired"
      | "cancelled"
      | "not-configured"
      | "transport"
      | "unknown",
    message: string,
  ) {
    super(message);
  }
}

interface FlowState {
  deviceCode: string;
  interval: number;
  expiresAt: number;
  cancelled: boolean;
}

const flows = new Map<string, FlowState>();

function tokenPath(): string {
  return path.join(app.getPath("userData"), "auth.enc");
}

// ─── Mid-flow recovery persistence ──────────────────────────────────────────
//
// In-memory `flows` evaporates if the app quits or crashes mid-poll. We
// persist enough state to LoginScreen so a relaunch can offer Resume —
// the user may have completed the GitHub side in the meantime and we'd
// otherwise force them to start over for no reason.
//
// State is plaintext JSON: the device-code is short-lived (~15 min) and
// only useful to whoever can also intercept the GitHub-side
// authorization, so encrypting it adds little. Token persistence
// continues to use safeStorage.

interface PersistedFlow {
  flowId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
  startedAt: number;
}

export interface DeviceFlowResumePayload {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

function flowStatePath(): string {
  return path.join(app.getPath("userData"), "device-flow.json");
}

function readPersistedFlow(): PersistedFlow | null {
  const p = flowStatePath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(
      fs.readFileSync(p, "utf8"),
    ) as Partial<PersistedFlow>;
    if (
      typeof raw.flowId !== "string" ||
      typeof raw.deviceCode !== "string" ||
      typeof raw.userCode !== "string" ||
      typeof raw.verificationUri !== "string" ||
      typeof raw.expiresAt !== "number" ||
      typeof raw.interval !== "number"
    ) {
      return null;
    }
    if (Date.now() >= raw.expiresAt) {
      // Stale — GitHub's device code already expired.
      fs.unlinkSync(p);
      return null;
    }
    return {
      flowId: raw.flowId,
      deviceCode: raw.deviceCode,
      userCode: raw.userCode,
      verificationUri: raw.verificationUri,
      expiresAt: raw.expiresAt,
      interval: raw.interval,
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function writePersistedFlow(flow: PersistedFlow): void {
  fs.writeFileSync(flowStatePath(), JSON.stringify(flow, null, 2) + "\n");
}

function clearPersistedFlow(): void {
  const p = flowStatePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/**
 * Recover an in-progress device flow that was interrupted by an app
 * quit or crash. Returns null when nothing recoverable exists.
 * Rehydrates the in-memory flow state so a subsequent pollDeviceFlow
 * call works exactly like a fresh start.
 */
export function resumeDeviceFlow(): DeviceFlowResumePayload | null {
  const persisted = readPersistedFlow();
  if (!persisted) return null;
  flows.set(persisted.flowId, {
    deviceCode: persisted.deviceCode,
    interval: persisted.interval,
    expiresAt: persisted.expiresAt,
    cancelled: false,
  });
  return {
    flowId: persisted.flowId,
    userCode: persisted.userCode,
    verificationUri: persisted.verificationUri,
    expiresAt: persisted.expiresAt,
  };
}

export function getStoredToken(): string | null {
  const p = tokenPath();
  if (!fs.existsSync(p)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = fs.readFileSync(p);
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

/**
 * v0.11.8 / ADR-0004. Returns Electron's currently-selected
 * safeStorage backend, or `null` when encryption is unavailable.
 *
 * `basic_text` on Linux indicates the obfuscation-only fallback —
 * the token is stored with a hardcoded seed and is functionally
 * cleartext to anyone with file-read access. The renderer surfaces
 * this as a one-time warning so the user can decide whether to
 * install a keyring or accept the risk.
 *
 * Other values (`gnome_libsecret`, `kwallet`, `keychain`, `dpapi`)
 * are real OS-managed encryption.
 */
export function getStorageBackend(): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  // `getSelectedStorageBackend` is Linux-only on Electron 32 — feature-
  // detect rather than crashing on macOS / Windows. When unavailable
  // we infer the backend from platform: macOS = keychain, Windows =
  // dpapi. The `basic_text` notice we care about can only surface on
  // Linux anyway, and there the method exists.
  type StorageBackendFn = () => string;
  const getter = (
    safeStorage as { getSelectedStorageBackend?: StorageBackendFn }
  ).getSelectedStorageBackend;
  if (typeof getter === "function") {
    return getter.call(safeStorage);
  }
  if (process.platform === "darwin") return "keychain";
  if (process.platform === "win32") return "dpapi";
  return "unknown";
}

function setStoredToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS keychain encryption not available");
  }
  const buf = safeStorage.encryptString(token);
  fs.writeFileSync(tokenPath(), buf);
}

export function clearStoredToken(): void {
  const p = tokenPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  if (!isAuthConfigured()) {
    throw new DeviceFlowError(
      "not-configured",
      "GitHub OAuth Client ID not set. See packages/desktop/src/main/auth-config.ts.",
    );
  }
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_SCOPE,
    }),
  });
  if (!res.ok) {
    throw new DeviceFlowError(
      "transport",
      `device code request failed: ${res.status}`,
    );
  }
  const data = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
  };
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new DeviceFlowError(
      "transport",
      "device code response missing required fields",
    );
  }
  const flowId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const interval = (data.interval ?? 5) * 1000;
  const expiresAt = Date.now() + (data.expires_in ?? 900) * 1000;
  flows.set(flowId, {
    deviceCode: data.device_code,
    interval,
    expiresAt,
    cancelled: false,
  });
  writePersistedFlow({
    flowId,
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt,
    interval,
    startedAt: Date.now(),
  });
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in ?? 900,
    interval: data.interval ?? 5,
    flowId,
  };
}

export function cancelDeviceFlow(flowId: string): void {
  const flow = flows.get(flowId);
  if (flow) flow.cancelled = true;
  clearPersistedFlow();
}

/**
 * Poll GitHub's token endpoint until the user completes the device-flow
 * grant on github.com (success), denies it (DeviceFlowError "denied"),
 * the code expires (DeviceFlowError "expired"), or the renderer cancels
 * via cancelDeviceFlow (DeviceFlowError "cancelled"). On success, the
 * token is encrypted to disk and the user object is returned.
 */
export async function pollDeviceFlow(flowId: string): Promise<GitHubUser> {
  const flow = flows.get(flowId);
  if (!flow) {
    throw new DeviceFlowError("unknown", `unknown flowId: ${flowId}`);
  }
  let interval = flow.interval;
  while (!flow.cancelled) {
    if (Date.now() >= flow.expiresAt) {
      flows.delete(flowId);
      clearPersistedFlow();
      throw new DeviceFlowError("expired", "device code expired");
    }
    await sleep(interval);
    if (flow.cancelled) break;

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code: flow.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    if (!res.ok) {
      throw new DeviceFlowError(
        "transport",
        `token poll failed: ${res.status}`,
      );
    }
    const data = (await res.json()) as {
      access_token?: string;
      error?: string;
      interval?: number;
    };
    if (data.access_token) {
      flows.delete(flowId);
      clearPersistedFlow();
      setStoredToken(data.access_token);
      return await fetchUser(data.access_token);
    }
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      interval = (data.interval ?? interval / 1000 + 5) * 1000;
      continue;
    }
    if (data.error === "access_denied") {
      flows.delete(flowId);
      clearPersistedFlow();
      throw new DeviceFlowError("denied", "user denied authorization");
    }
    if (data.error === "expired_token") {
      flows.delete(flowId);
      clearPersistedFlow();
      throw new DeviceFlowError("expired", "device code expired");
    }
    flows.delete(flowId);
    clearPersistedFlow();
    throw new DeviceFlowError(
      "unknown",
      `unexpected token response: ${data.error ?? "no token"}`,
    );
  }
  flows.delete(flowId);
  clearPersistedFlow();
  throw new DeviceFlowError("cancelled", "polling cancelled");
}

async function fetchUser(token: string): Promise<GitHubUser> {
  const res = await fetch(USER_API, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new DeviceFlowError("transport", `user lookup failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    login?: string;
    avatar_url?: string;
    html_url?: string;
  };
  if (!data.login) {
    throw new DeviceFlowError("transport", "user response missing login");
  }
  return {
    login: data.login,
    avatarUrl: data.avatar_url ?? "",
    htmlUrl: data.html_url ?? "",
  };
}

export async function getCurrentUser(): Promise<GitHubUser | null> {
  const token = getStoredToken();
  if (!token) return null;
  try {
    return await fetchUser(token);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
