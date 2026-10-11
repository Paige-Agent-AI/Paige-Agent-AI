// The two shell dependencies that need a running app: the PAIGE presence context and the dial pad.
// Neither affects the rail or the canvas this harness renders.
export function useAgentPresence() {
  return { railExpanded: false, expandRail: () => {}, collapseRail: () => {} };
}
export function DialPadTrigger() {
  return null;
}
