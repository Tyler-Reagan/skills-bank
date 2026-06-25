import React, { useMemo } from "react";
import type { InvocationStats, RegistryEntry } from "@skills-bank/core";
import type { TrackingStatus } from "../../shared/ipc.js";
import { useIpcQuery } from "../hooks/useIpcQuery.js";
import { Icon } from "./Icon.js";

interface Props {
  /** Registry entries, for cross-referencing skill names → descriptions. */
  registry: RegistryEntry[];
  /** Open Settings (where the tracking toggle lives) — the off-state CTA. */
  onOpenSettings: () => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/**
 * Metrics tab — per-skill invocation counts from the local hook log.
 *
 * Three states (tracking is opt-in via Settings):
 *  1. off + no history  → full-page CTA to enable.
 *  2. off + has history → prominent "currently off" notice + the prior
 *     stats, stamped with the date range they cover.
 *  3. on                → ranked usage + summary + a minimal coverage line.
 *
 * Reads on mount; a manual Refresh re-reads (the log is appended to by a
 * separate process, so there's no live binding by design).
 */
export function MetricsTab({
  registry,
  onOpenSettings,
}: Props): React.ReactElement {
  const { data: status, refetch: refetchStatus } = useIpcQuery<TrackingStatus>(
    () => window.skillsBank.getSkillTrackingStatus(),
    [],
  );
  const { data: stats, refetch: refetchStats } = useIpcQuery<InvocationStats>(
    () => window.skillsBank.getInvocationStats(),
    [],
  );

  const descByName = useMemo(
    () => new Map(registry.map((e) => [e.name, e.description] as const)),
    [registry],
  );

  const refresh = (): void => {
    refetchStatus();
    refetchStats();
  };

  if (!status || !stats) {
    return (
      <div className="metrics-tab">
        <p className="text-subtle">Loading…</p>
      </div>
    );
  }

  const hasHistory = stats.totalEvents > 0;
  const trackingActive =
    status.state === "on" || status.state === "needs-repair";

  // State 1: off and nothing ever recorded → pure CTA.
  if (!trackingActive && !hasHistory) {
    return (
      <div className="metrics-tab">
        <div className="empty-state">
          <strong>Skill usage tracking is off</strong>
          <p>
            Turn it on to start recording which Claude Code skills you invoke.
            Everything stays on this machine.
          </p>
          <div className="row-wrap-center mt-16">
            <button className="btn primary" onClick={onOpenSettings}>
              Enable in Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  const max = stats.perSkill[0]?.count ?? 1;

  return (
    <div className="metrics-tab">
      <div className="metrics-header">
        <h2 className="metrics-title">Metrics</h2>
        <button className="btn ghost" type="button" onClick={refresh}>
          <Icon name="refresh" size="sm" /> Refresh
        </button>
      </div>

      <p className="metrics-subtitle text-subtle">
        Claude Code skill invocations on this machine.
      </p>

      {status.state === "needs-repair" && (
        <div className="metrics-banner metrics-banner--warn">
          The tracking hook script is missing. Re-enable tracking in Settings to
          restore it — usage isn't being recorded until then.
        </div>
      )}

      {!trackingActive && (
        <div className="metrics-banner">
          Tracking is currently <strong>off</strong> — no new usage is being
          recorded. Showing history through{" "}
          {fmtDate(
            status.coverage.windows[status.coverage.windows.length - 1]
              ?.endAt ?? null,
          )}
          .{" "}
          <button className="link-btn" onClick={onOpenSettings}>
            Turn it back on
          </button>
        </div>
      )}

      <div className="metrics-summary">
        <span>
          <strong className="tabular-nums">{stats.totalEvents}</strong>{" "}
          invocations
        </span>
        <span>
          <strong className="tabular-nums">{stats.perSkill.length}</strong>{" "}
          skills
        </span>
        <span>
          <strong className="tabular-nums">{stats.sessions}</strong> sessions
        </span>
        <span className="text-subtle">
          tracked since {fmtDate(status.coverage.trackedSince)}
          {status.coverage.gaps.length > 0
            ? ` · ${status.coverage.gaps.length} gap${status.coverage.gaps.length === 1 ? "" : "s"}`
            : ""}
        </span>
      </div>

      <ol className="metrics-list">
        {stats.perSkill.map((s) => {
          const desc = descByName.get(s.skill);
          return (
            <li key={s.skill} className="metrics-row">
              <div className="metrics-row-main">
                <div className="metrics-row-head">
                  <span className="metrics-skill">{s.skill}</span>
                  <span className="metrics-count tabular-nums">{s.count}</span>
                </div>
                {desc && (
                  <span className="metrics-desc text-subtle">{desc}</span>
                )}
                <div className="metrics-bar-track" aria-hidden="true">
                  <div
                    className="metrics-bar-fill"
                    style={{ width: `${Math.max(2, (s.count / max) * 100)}%` }}
                  />
                </div>
                <span className="metrics-last text-subtle">
                  last used {fmtDateTime(s.lastInvokedAt)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
