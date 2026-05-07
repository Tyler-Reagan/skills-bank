import React, { createContext, useContext } from "react";
import type { Persona } from "../shared/ipc.js";

const PersonaContext = createContext<Persona | null>(null);

export function PersonaProvider({
  persona,
  children,
}: {
  persona: Persona | null;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <PersonaContext.Provider value={persona}>
      {children as React.ReactElement}
    </PersonaContext.Provider>
  );
}

export function usePersona(): Persona | null {
  return useContext(PersonaContext);
}
