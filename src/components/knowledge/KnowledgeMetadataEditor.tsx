import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { KnowledgeServiceError, readKnowledge, updateKnowledgeMetadata, type KnowledgeDocument } from '@/lib/knowledge-service';
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Mount for one document/workspace; closing ends the attempt, it cannot cancel a sent save. */
export function KnowledgeMetadataEditor({ document, tenantId, onSaved, onClose }: {
  document: KnowledgeDocument; tenantId: string;
  onSaved?: (document: KnowledgeDocument) => void; onClose: () => void;
}) {
  const [base, setBase] = useState(document);
  const [title, setTitle] = useState(document.title);
  const [summary, setSummary] = useState(document.summary ?? '');
  const [category, setCategory] = useState(document.category ?? '');
  const [tags, setTags] = useState((document.tags ?? []).join(', '));
  const [status, setStatus] = useState<'editing' | 'saving' | 'conflict' | 'uncertain' | 'saved' | 'unrecorded' | 'refused'>('editing');
  const [message, setMessage] = useState('');
  const [latest, setLatest] = useState<KnowledgeDocument | null>(null);
  const [reading, setReading] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const scope = useRef({ tenantId, id: document.id });
  if (scope.current.tenantId !== tenantId || scope.current.id !== document.id) scope.current = { tenantId, id: document.id };
  const attempt = scope.current;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = () => mounted.current && scope.current === attempt && base.tenant_id === tenantId;

  const save = async () => {
    if (busy.current || status !== 'editing' || !valid() || !tenantId) return;
    const parsedTags = [...new Set(tags.split(',').map(tag => tag.trim()).filter(Boolean))];
    if (!title.trim() || title.trim().length > 300 || summary.length > 2000 || category.length > 100 || parsedTags.length > 20 || parsedTags.some(tag => tag.length > 60)) {
      setMessage('Use a title of 1–300 characters, a summary up to 2,000, a category up to 100, and at most 20 tags of 60 characters each.');
      return;
    }
    busy.current = true; setStatus('saving'); setMessage('Saving metadata…');
    try {
      const result = await updateKnowledgeMetadata(supabase, tenantId, base.id, base.revision, { title: title.trim(), summary: summary || null, category: category || null, tags: parsedTags });
      if (!valid()) return;
      setBase(result.document);
      setStatus(result.outcome === 'capability_completed_unrecorded' ? 'unrecorded' : 'saved');
      setMessage(result.outcome === 'capability_completed_unrecorded' ? 'Metadata saved. The activity receipt could not be recorded. Do not repeat this save.' : 'Metadata saved.');
      onSaved?.(result.document);
    } catch (error) {
      if (!valid()) return;
      if (error instanceof KnowledgeServiceError && error.code === '40001') {
        setStatus('conflict'); setMessage('This document changed since you opened it. Read the current version before editing again. Your draft is still here.');
      } else if (error instanceof KnowledgeServiceError && ['42501', '22023', 'P0002'].includes(error.code)) {
        setStatus('refused'); setMessage('The save was refused. Check your workspace, access, and whether this document still exists. Close and reopen it before trying again.');
      } else {
        setStatus('uncertain'); setMessage('We could not confirm this save. Read the current version before deciding what to do next. Do not repeat the save.');
      }
    } finally { busy.current = false; }
  };
  const readCurrent = async () => {
    if (busy.current || !valid()) return;
    busy.current = true; setReading(true); setLatest(null);
    try {
      const docs = await readKnowledge(supabase, tenantId, { documentId: base.id });
      if (!valid()) return;
      if (docs.some(doc => doc.id !== base.id)) throw new Error('Requested Knowledge source did not match.');
      setLatest(docs[0] ?? null);
      if (!docs.length) setMessage('This document is no longer available in this workspace. Your draft has not been resubmitted.');
    } catch { if (valid()) setMessage('The current version could not be read. Keep your draft and check your connection or workspace before reading again.'); }
    finally { busy.current = false; if (valid()) setReading(false); }
  };
  const useCurrent = () => {
    if (!latest || !valid()) return;
    setBase(latest); setTitle(latest.title); setSummary(latest.summary ?? ''); setCategory(latest.category ?? ''); setTags((latest.tags ?? []).join(', ')); setLatest(null); setStatus('editing'); setMessage('Current version loaded. Review your changes before saving.');
  };
  return <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>Edit knowledge metadata</DialogTitle><DialogDescription>Organize this source without changing its content. Revision {base.revision}.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <div className="space-y-1.5"><Label htmlFor="knowledge-title">Title</Label><Input id="knowledge-title" value={title} onChange={e=>setTitle(e.target.value)} disabled={status !== 'editing'} maxLength={300} /></div>
      <div className="space-y-1.5"><Label htmlFor="knowledge-summary">Summary</Label><Textarea id="knowledge-summary" value={summary} onChange={e=>setSummary(e.target.value)} disabled={status !== 'editing'} maxLength={2000} /></div>
      <div className="space-y-1.5"><Label htmlFor="knowledge-category">Category</Label><Input id="knowledge-category" value={category} onChange={e=>setCategory(e.target.value)} disabled={status !== 'editing'} maxLength={100} /></div>
      <div className="space-y-1.5"><Label htmlFor="knowledge-tags">Tags, separated by commas</Label><Input id="knowledge-tags" value={tags} onChange={e=>setTags(e.target.value)} disabled={status !== 'editing'} /></div>
      {message && <p role="status" className="text-sm">{message}</p>}
      {latest && <section aria-label="Current saved version" className="space-y-2 border-t pt-3 text-sm break-words"><h3 className="font-medium">Current saved version · revision {latest.revision}</h3><p>{latest.title}</p><p>{latest.summary || 'No summary'}</p><p>{latest.category || 'No category'}</p><p>{latest.tags?.join(', ') || 'No tags'}</p><Button variant="outline" onClick={useCurrent}>Use current version</Button><p className="text-muted-foreground">This replaces your draft with the saved fields. A readback does not prove who made the change or that an activity receipt exists.</p></section>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={onClose}>{status === 'saved' || status === 'unrecorded' ? 'Done' : 'Close'}</Button>
        {(status === 'conflict' || status === 'uncertain') && <Button onClick={readCurrent} disabled={reading}>{reading ? 'Reading…' : 'Read current version'}</Button>}
        {(status === 'editing' || status === 'saving') && <Button onClick={save} disabled={status === 'saving' || !tenantId}>{status === 'saving' ? 'Saving…' : 'Save metadata'}</Button>}
      </div>
    </div>
  </DialogContent>;
}
