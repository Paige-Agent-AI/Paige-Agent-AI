export { departmentLabel, elapsedLabel } from "@/solo/data/useSoloActivityFeed";
export function useSoloActivityFeed() {
  return { status: "ready", items: [], refresh: () => undefined };
}
