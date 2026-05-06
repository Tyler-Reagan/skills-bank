import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { GITHUB_CLIENT_ID, GITHUB_SCOPE } from "./auth-config.js";

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
  if (
    GITHUB_CLIENT_ID === "REPLACE_WITH_OAUTH_APP_CLIENT_ID" ||
    !GITHUB_CLIENT_ID
  ) {
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
      throw new DeviceFlowError("denied", "user denied authorization");
    }
    if (data.error === "expired_token") {
      flows.delete(flowId);
      throw new DeviceFlowError("expired", "device code expired");
    }
    flows.delete(flowId);
    throw new DeviceFlowError(
      "unknown",
      `unexpected token response: ${data.error ?? "no token"}`,
    );
  }
  flows.delete(flowId);
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
