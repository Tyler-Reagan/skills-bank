import React, { createContext, useContext } from "react";
import type { RegistrySource } from "../shared/ipc.js";

const RegistrySourceContext = createContext<RegistrySource | null>(null);

export function RegistrySourceProvider({
  registrySource,
  children,
}: {
  registrySource: RegistrySource | null;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <RegistrySourceContext.Provider value={registrySource}>
      {children as React.ReactElement}
    </RegistrySourceContext.Provider>
  );
}

export function useRegistrySource(): RegistrySource | null {
  return useContext(RegistrySourceContext);
}
