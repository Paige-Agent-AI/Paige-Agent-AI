// The fixture state, chosen by `?mode=` so each drive frame is one fresh, deterministic load.
export type HarnessMode = "populated" | "first" | "loading" | "error" | "readonly" | "full";
const requested = new URLSearchParams(window.location.search).get("mode");
export const mode: HarnessMode = (["populated", "first", "loading", "error", "readonly", "full"] as const)
  .find((value) => value === requested) ?? "populated";
