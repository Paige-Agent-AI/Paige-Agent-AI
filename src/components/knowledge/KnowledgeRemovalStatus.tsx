import { Button } from '@/components/ui/button';
import type { useKnowledgeRemoval } from '@/hooks/useKnowledgeRemoval';
export function KnowledgeRemovalStatus({ removal }: { removal: ReturnType<typeof useKnowledgeRemoval> }) {
  if (!removal.message) return null;
  return <div role="status" className="space-y-2 text-sm break-words">
    <p>{removal.message}</p>
    {removal.uncertain && <Button variant="outline" disabled={removal.busy} onClick={() => void removal.check()}>{removal.busy ? 'Checking document…' : 'Check document status'}</Button>}
  </div>;
}
