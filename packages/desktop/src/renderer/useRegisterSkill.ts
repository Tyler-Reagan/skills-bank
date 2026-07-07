import { useCallback } from "react";
import type { AgentId, RegistrationResult } from "@skills-bank/core";
import { useRegistry } from "./RegistryContext.js";
import { useSettings } from "./SettingsContext.js";
import { useRegistryHost } from "./RegistryHostContext.js";

/**
 * Discovery target for a registration. Mirrors core's `ActionTarget`:
 * `agent` is the agent dir the install was found in. Forwarded onto the
 * action so the main-process scan can locate the exact entry when the
 * same name exists in multiple agent dirs.
 */
interface RegisterTarget {
  agent?: AgentId;
}

interface RegisterArgs {
  name: string;
  target?: RegisterTarget;
}

interface UseRegisterSkill {
  registerSkill: (args: RegisterArgs) => Promise<RegistrationResult>;
}

/**
 * Register a skill into the bank. Register moves the skill's files into
 * `<registryRoot>/skills/` and links the default agent set (ADR-0022 —
 * Registered ⇔ files under the bank). One effect, no chain. Flashes the
 * result and refreshes; returns the `RegistrationResult` so callers can
 * decide whether to close a drawer.
 *
 * Bulk "Register All" does NOT use this hook — it opens the row-based
 * `RegistrationPlanModal`, which speaks the same `register` vocabulary.
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
    async ({ name, target }: RegisterArgs) => {
      const results = await window.skillsBank.register([
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
      const result = results[0]!;
      flash(result.message);
      await refresh();
      return result;
    },
    [fanoutAgents, flash, refresh],
  );

  return { registerSkill };
}
