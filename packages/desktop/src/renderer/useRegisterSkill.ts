import { useCallback } from "react";
import type { AgentId, RegistrationResult } from "@skills-bank/core";
import { useRegistry } from "./RegistryContext.js";
import { useSettings } from "./SettingsContext.js";
import { useRegistryHost } from "./RegistryHostContext.js";

/**
 * Discovery target for a registration. Mirrors core's `ActionTarget`:
 * `agent` is the agent dir the install was found in (`"agents"` for a
 * custom-dir entry), `customDir` the originating user directory. Both
 * are forwarded onto the action so the main-process scan can locate the
 * entry — custom-dir registrations FAIL without `customDir` because the
 * scan otherwise never walks that directory.
 */
interface RegisterTarget {
  agent?: AgentId;
  customDir?: string;
}

interface RegisterArgs {
  name: string;
  target?: RegisterTarget;
  /**
   * True when the skill lives in a user custom directory. Suppresses the
   * auto-move-into-bank chain regardless of `settings.registerAdopts` —
   * keep-in-place is the whole point of a custom dir (a non-egressable
   * work repo stays on disk).
   */
  isInPlace: boolean;
}

interface MoveIntoBankArgs {
  name: string;
  target?: RegisterTarget;
}

interface UseRegisterSkill {
  registerSkill: (args: RegisterArgs) => Promise<RegistrationResult>;
  moveIntoBank: (args: MoveIntoBankArgs) => Promise<RegistrationResult>;
}

/**
 * Single source of the register/move-into-bank chain logic. Both inline
 * call sites (Installed-tab per-card Register, drawer Register) route
 * through here so the "record, then optionally relocate" decision lives in
 * exactly one place. Bulk "Register All" does NOT use this hook — it opens
 * the row-based `RegistrationPlanModal` instead.
 *
 * - `registerSkill` records the skill in place (never moves files), then
 *   — iff `settings.registerAdopts && !isInPlace` — chains a
 *   `move-into-bank` so portability-minded users get the old one-gesture
 *   adopt. The chain predicate is defined ONCE here.
 * - `moveIntoBank` is the standalone relocate primitive (drawer "Move
 *   into bank" affordance for an already-registered in-place skill).
 *
 * Both flash the result and refresh; both return the final
 * `RegistrationResult` so callers can decide whether to close a drawer.
 *
 * The `RegistrationPlanModal` deliberately does NOT use this hook — it
 * builds per-row actions for explicit disambiguation — but it speaks the
 * same `register` / `move-into-bank` vocabulary.
 */
export function useRegisterSkill(): UseRegisterSkill {
  const { refresh } = useRegistry();
  const { settings } = useSettings();
  const { flash } = useRegistryHost();

  const fanoutAgents: AgentId[] | undefined =
    settings.defaultInstallAgents.length > 0
      ? settings.defaultInstallAgents
      : undefined;

  const registerSkill = useCallback(
    async ({ name, target, isInPlace }: RegisterArgs) => {
      const recordResults = await window.skillsBank.register([
        {
          name,
          action: {
            type: "register",
            name,
            ...target,
            ...(fanoutAgents ? { agents: fanoutAgents } : {}),
          },
        },
      ]);
      let result = recordResults[0]!;
      // Auto-move-after-register: only when the global toggle is on AND
      // the skill isn't tracked in place. Custom-dir provenance always
      // suppresses the chain.
      if (result.ok && settings.registerAdopts && !isInPlace) {
        const moveResults = await window.skillsBank.register([
          {
            name,
            action: {
              type: "move-into-bank",
              name,
              ...target,
              ...(fanoutAgents ? { agents: fanoutAgents } : {}),
            },
          },
        ]);
        result = moveResults[0]!;
      }
      flash(result.message);
      await refresh();
      return result;
    },
    [fanoutAgents, settings.registerAdopts, flash, refresh],
  );

  const moveIntoBank = useCallback(
    async ({ name, target }: MoveIntoBankArgs) => {
      const results = await window.skillsBank.register([
        {
          name,
          action: {
            type: "move-into-bank",
            name,
            ...target,
            ...(fanoutAgents ? { agents: fanoutAgents } : {}),
          },
        },
      ]);
      const result = results[0]!;
      flash(result.message);
      await refresh();
      return result;
    },
    [fanoutAgents, flash, refresh],
  );

  return { registerSkill, moveIntoBank };
}
