import { afterEach, describe, expect, it, vi } from "vitest";

const { getSupabaseClientMock } = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
}));

vi.mock("../lib/auth", () => ({ getSupabaseClient: getSupabaseClientMock }));

import { useApp } from "../lib/store";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetAllMocks();
  useApp.setState({
    scientificJob: null,
    scientificJobError: null,
  });
});

describe("scientific job restoration", () => {
  it("restores the latest queued job for the signed-in user", async () => {
    vi.useFakeTimers();
    const row = {
      id: "job-1",
      item_id: "S2-item",
      status: "queued",
      stage: "queued",
      progress: 0,
      error_message: null,
      result: null,
      provenance: null,
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    getSupabaseClientMock.mockReturnValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }) },
      from,
    });

    await useApp.getState().restoreScientificJob();

    expect(from).toHaveBeenCalledWith("scientific_jobs");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(useApp.getState().scientificJob).toMatchObject({
      id: "job-1",
      itemId: "S2-item",
      status: "queued",
      stage: "queued",
    });
  });
});
