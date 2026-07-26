import { afterEach, describe, expect, it } from "vitest";

import { useAgentStore } from "@/lib/stores/agentStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";

const originalProviderId = useAgentStore.getState().providerId;
const originalDefaultProviderId = usePrefsStore.getState().defaultProviderId;

afterEach(() => {
  useAgentStore.setState({
    providerId: originalProviderId,
    catalog: null,
    catalogError: null,
  });
  usePrefsStore.setState({ defaultProviderId: originalDefaultProviderId });
});

describe("agent provider preference", () => {
  it("restores the persisted provider after asynchronous settings hydration", () => {
    useAgentStore.setState({ providerId: null });
    usePrefsStore.setState({ defaultProviderId: "provider-remembered" });

    useAgentStore
      .getState()
      .hydrateProviderId(usePrefsStore.getState().defaultProviderId);

    expect(useAgentStore.getState().providerId).toBe("provider-remembered");
    expect(usePrefsStore.getState().defaultProviderId).toBe("provider-remembered");
  });
});
