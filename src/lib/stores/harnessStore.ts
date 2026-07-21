import { create } from "zustand";

import type { CustomAgentHarness } from "@/lib/acp/types";

const STORAGE_KEY = "glyphra.agent-harnesses.v1";

function readHarnesses(): CustomAgentHarness[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? (value as CustomAgentHarness[]) : [];
  } catch {
    return [];
  }
}

function persist(harnesses: CustomAgentHarness[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(harnesses));
}

interface HarnessState {
  harnesses: CustomAgentHarness[];
  upsert: (harness: Omit<CustomAgentHarness, "id"> & { id?: string }) => CustomAgentHarness;
  remove: (id: string) => void;
}

export const useHarnessStore = create<HarnessState>((set) => ({
  harnesses: readHarnesses(),
  upsert: (input) => {
    const harness: CustomAgentHarness = {
      ...input,
      id: input.id || crypto.randomUUID(),
      name: input.name.trim(),
      command: input.command.trim(),
      args: input.args ?? [],
      env: input.env ?? {},
    };
    set((state) => {
      const harnesses = [...state.harnesses.filter((item) => item.id !== harness.id), harness];
      persist(harnesses);
      return { harnesses };
    });
    return harness;
  },
  remove: (id) => {
    set((state) => {
      const harnesses = state.harnesses.filter((item) => item.id !== id);
      persist(harnesses);
      return { harnesses };
    });
  },
}));
