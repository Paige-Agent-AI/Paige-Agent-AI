import { Button } from '@/components/ui/button';
import type { OriginalSpecialistHistory } from './specialistHistory';

export function OriginalSpecialistResult({ history, status, blocked, onCheck }: {
  history?: OriginalSpecialistHistory; status?: 'checking' | 'unverified';
  blocked: boolean; onCheck(): void;
}) {
  return <section className="mt-3 border-t border-border pt-3" aria-label="Original specialist assignment">
    <Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal text-left"
      disabled={blocked || status === 'checking'} aria-busy={status === 'checking' || undefined} onClick={onCheck}>
      {status === 'checking' ? 'Checking original result…' : history ? 'Refresh original result' : 'Check original result'}
    </Button>
    {status === 'unverified' && <p role="status" className="mt-2 text-sm text-muted-foreground">
      The original result could not be verified. Nothing was retried.
    </p>}
    {!status && history?.results.map(result => <div key={result.id} className="mt-3 space-y-2" data-paige-original-specialist-result>
      <p role="status" className="text-sm font-medium">
        {result.specialist === 'zion' ? 'ZION' : result.specialist} · {result.recorded_status === 'succeeded' ? 'Response recorded'
          : result.recorded_status === 'failed' ? 'Assignment failed'
            : result.recorded_status === 'dispatched' ? 'Dispatched; completion unverified'
              : result.recorded_status === 'pending' ? 'Still pending' : 'Outcome unknown'}
      </p>
      <p className="text-xs text-muted-foreground">{result.receipt_state === 'verified' ? 'Original receipt verified'
        : result.receipt_state === 'conflicting' ? 'Receipt needs review' : 'Receipt not verified'}</p>
      {result.response_text !== null && <details>
        <summary className="cursor-pointer rounded-sm text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Read original response{result.response_truncated ? ' (shortened)' : ''}
        </summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{result.response_text}</p>
      </details>}
      <p className="text-xs text-muted-foreground">Business actions need their own results.</p>
    </div>)}
    {!status && history?.limited && <p className="mt-2 text-xs text-muted-foreground">Only the first three original assignments are shown.</p>}
  </section>;
}
