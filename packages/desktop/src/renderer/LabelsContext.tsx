import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { LabelsMap } from "@skills-bank/core";

interface LabelsContextValue {
  labelsMap: LabelsMap;
  reload: () => Promise<void>;
}

const LabelsContext = createContext<LabelsContextValue | null>(null);

export function useLabels(): LabelsContextValue {
  const ctx = useContext(LabelsContext);
  if (!ctx) throw new Error("useLabels must be used inside <LabelsProvider>");
  return ctx;
}

export function LabelsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [labelsMap, setLabelsMap] = useState<LabelsMap>({});

  const reload = useCallback(async () => {
    const map = await window.skillsBank.readLabels();
    setLabelsMap(map);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <LabelsContext.Provider value={{ labelsMap, reload }}>
      {children}
    </LabelsContext.Provider>
  );
}
