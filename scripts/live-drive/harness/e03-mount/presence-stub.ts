export * from "../../../../src/components/ui/paige";
export function useAgentPresence() { return { expandRail: () => { window.dispatchEvent(new Event("e03-paige-open")); } }; }
