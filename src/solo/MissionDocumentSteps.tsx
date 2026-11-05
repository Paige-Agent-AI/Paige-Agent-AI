import {useId, useLayoutEffect, useRef, useState,type ReactNode} from 'react';
import {useParams} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {useOptionalTenantContext} from '@/hooks/useTenantContext';
import type {DocumentWorkIntent, DocumentWorkStep} from '@/types/businessMission';
import {readKnowledgeSourceEvidence} from '../../supabase/functions/_shared/knowledge-source-evidence';
import type {ExtractionRpc} from '../../supabase/functions/_shared/knowledge-extraction';
import './mission-document-steps.css';

type Props = {
  tenantId: string | null | undefined;
  value?: DocumentWorkIntent | null;
  status?: 'none' | 'available' | 'source_changed' | 'source_unavailable';
  onChange?: (value: DocumentWorkIntent | null) => void;
  disabled?: boolean;
  renderTask?: (step:DocumentWorkStep)=>ReactNode;
};
type Quotation = {phase: 'loading' | 'available' | 'unavailable'; text?: string[]};
const caller = supabase as unknown as ExtractionRpc;

/** Edits the original immutable brief's draft data; creates no work or approval. */
export function MissionDocumentSteps({tenantId, value, status, onChange, disabled, renderTask}: Props) {
  const {account} = useParams<{account: string}>();
  const identity = useOptionalTenantContext();
  const id = useId();
  const scope = useRef({live: true, generation: 0, key: ''});
  const key = JSON.stringify([identity?.activeUserId, identity?.activeTenantId, identity?.accountContextStatus, identity?.loading, tenantId, value?.sources]);
  if (scope.current.key !== key) {scope.current.key = key; scope.current.generation++;}
  const [quotes, setQuotes] = useState<{key: string; rows: Record<string, Quotation>}>({key, rows: {}});
  useLayoutEffect(() => {const current = scope.current; current.live = true; return () => {current.live = false; current.generation++;};}, []);
  const editable = !!onChange && !disabled;
  if (!identity?.activeUserId || identity.loading || identity.accountContextStatus !== 'ready' || identity.activeTenantId !== tenantId) {
    return <p role="status">Select the current workspace to review this plan's document steps.</p>;
  }
  if (!value) {
    if (status === 'source_changed' || status === 'source_unavailable') return <section className="pim-document-steps space-y-3">
      <p className="ov-note" role="status">This plan's source has changed or is unavailable. Review the current document in Knowledge before proposing new work. Saved source details are withheld.</p>
      {editable && (value === null ? <p role="status">The retained document steps will be removed when you save this revision.</p> :
        <button className="btn" type="button" disabled={disabled} onClick={() => onChange!(null)}>Remove document steps from this plan</button>)}
    </section>;
    return onChange ? <p className="text-sm">Ask Paige to propose agreement steps from a saved Knowledge document. You can then edit them here.</p> : null;
  }

  const changeStep = (stepId: string, patch: Partial<DocumentWorkStep>) => {
    if (!editable) return;
    onChange!({...value, steps: value.steps.map(step => step.id === stepId ? {...step, ...patch} : step)});
  };
  const inspect = async (documentId: string) => {
    if (disabled || !tenantId || identity?.activeTenantId !== tenantId || identity.accountContextStatus !== 'ready' || identity.loading) return;
    const source = value.sources.find(item => item.reference.documentId === documentId);
    if (!source) return;
    const generation = scope.current.generation;
    const current = () => scope.current.live && scope.current.generation === generation && scope.current.key === key;
    setQuotes(previous => ({key, rows: {...(previous.key === key ? previous.rows : {}), [documentId]: {phase: 'loading'}}}));
    const result = await readKnowledgeSourceEvidence(caller, {tenantId, documentId, expected: source.reference,
      excerpts: source.excerpts.map(({start, end}) => ({start, end}))}, current);
    if (!current()) return;
    setQuotes(previous => ({key, rows: {...(previous.key === key ? previous.rows : {}), [documentId]: result.status === 'available'
      ? {phase: 'available', text: result.excerpts.map(item => item.text)} : {phase: 'unavailable'}}}));
  };
  const add = () => {
    if (!editable || value.steps.length >= 50) return;
    onChange!({...value, steps: [...value.steps, {id: crypto.randomUUID(), title: '', description: '', responsible: {kind: 'unassigned'},
      dueOn: null, dependencies: [], sourceIds: [], basis: 'recommendation', proposedTask: {action: 'task.create', assigneeUserId: null}}]});
  };
  return <section className="mission-document-steps space-y-4" aria-labelledby={id}>
    <h4 id={id}>Agreement steps and sources</h4>
    <p className="text-sm">Saving these steps updates the plan. Creating tasks requires a separate review of the exact work.</p>
    <ul className="space-y-3">
      {value.sources.map(source => {
        const documentId = source.reference.documentId;
        const quote = quotes.key === key ? quotes.rows[documentId] : undefined;
        return <li key={documentId} className="space-y-2">
          <p className="break-words">{source.title} · Revision {source.reference.revision}</p>
          <div className="flex flex-wrap gap-2">
            {account && <a className="sd-btn sd-btn-sm" target="_blank" rel="noopener noreferrer"
              href={`/solo/${encodeURIComponent(account)}/settings/setup/knowledge-bucket?knowledge=${encodeURIComponent(documentId)}`}>Open source in new tab</a>}
            <button type="button" className="sd-btn sd-btn-sm" disabled={disabled} aria-busy={quote?.phase === 'loading'} aria-disabled={disabled || quote?.phase === 'loading'}
              onClick={() => {if (quote?.phase !== 'loading') void inspect(documentId);}}>Check source quotations</button>
          </div>
          {quote?.phase === 'loading' && <p role="status">Checking this source version…</p>}
          {quote?.phase === 'unavailable' && <p role="status">The source changed or cannot be read. No saved quotation is being shown. Review the current document before using it.</p>}
          {quote?.phase === 'available' && quote.text?.map((text, n) => <blockquote className="whitespace-pre-wrap break-words text-sm" key={n}>{text}</blockquote>)}
        </li>;
      })}
    </ul>
    <ol className="space-y-4">
      {value.steps.map((step, index) => <li key={step.id}>
        {onChange ? <fieldset disabled={disabled} className="space-y-3 min-w-0">
          <legend>Step {index + 1}</legend>
          <label className="ov-field"><span>Step title</span><input className="fin" maxLength={180} value={step.title} onChange={event => changeStep(step.id, {title: event.target.value})}/></label>
          <label className="ov-field"><span>Work to do</span><textarea className="fin" maxLength={4000} value={step.description} onChange={event => changeStep(step.id, {description: event.target.value})}/></label>
          <label className="ov-field"><span>Basis</span><select className="fin" value={step.basis} onChange={event => changeStep(step.id, {basis: event.target.value as DocumentWorkStep['basis']})}>
            <option value="recommendation">Recommendation</option><option value="source_obligation">Obligation described by the source</option>
          </select></label>
          <label className="ov-field"><span>Responsible</span><select className="fin"
            value={step.responsible.kind === 'person' ? step.responsible.userId === identity?.activeUserId ? 'me' : 'existing_person' : step.responsible.kind === 'specialist' ? 'specialist' : 'unassigned'}
            onChange={event => {
              if (event.target.value === 'me' && identity?.activeUserId) changeStep(step.id, {responsible: {kind: 'person', userId: identity.activeUserId}, proposedTask: {action: 'task.create', assigneeUserId: identity.activeUserId}});
              else if (event.target.value === 'specialist') changeStep(step.id, {responsible: {kind: 'specialist', alias: 'MENTOR'}, proposedTask: {action: 'task.create', assigneeUserId: null}});
              else changeStep(step.id, {responsible: {kind: 'unassigned'}, proposedTask: {action: 'task.create', assigneeUserId: null}});
            }}>
            <option value="unassigned">Not assigned</option>{identity?.activeUserId && <option value="me">Me</option>}
            <option value="specialist">Specialist handoff proposed</option>
            {step.responsible.kind === 'person' && step.responsible.userId !== identity?.activeUserId && <option value="existing_person">Existing proposed person</option>}
          </select></label>
          {step.responsible.kind === 'specialist' && <p className="text-sm break-words">{step.responsible.alias}: proposed handoff. A specialist name does not assign a task to a person.</p>}
          <label className="ov-field"><span>Due date, if known</span><input className="fin" type="date" value={step.dueOn ?? ''} onChange={event => changeStep(step.id, {dueOn: event.target.value || null})}/></label>
          <fieldset className="min-w-0"><legend>Sources for this step</legend>{value.sources.map(source => <label className="flex items-start gap-2 text-sm" key={source.reference.documentId}>
            <input type="checkbox" checked={step.sourceIds.includes(source.reference.documentId)} onChange={event => changeStep(step.id, {sourceIds: event.target.checked
              ? [...step.sourceIds, source.reference.documentId] : step.sourceIds.filter(item => item !== source.reference.documentId)})}/><span className="min-w-0 break-words">{source.title}</span>
          </label>)}</fieldset>
          {value.steps.length > 1 && <fieldset className="min-w-0"><legend>Depends on</legend>{value.steps.filter(other => other.id !== step.id).map(other => <label className="flex items-start gap-2 text-sm" key={other.id}>
            <input type="checkbox" checked={step.dependencies.includes(other.id)} onChange={event => changeStep(step.id, {dependencies: event.target.checked
              ? [...step.dependencies, other.id] : step.dependencies.filter(item => item !== other.id)})}/><span className="min-w-0 break-words">{other.title || 'Untitled step'}</span>
          </label>)}</fieldset>}
          <button type="button" className="sd-btn sd-btn-sm" onClick={() => {
            if (!editable) return;
            onChange!({...value, steps: value.steps.filter(other => other.id !== step.id).map(other => ({...other, dependencies: other.dependencies.filter(item => item !== step.id)}))});
          }}>Remove step {index + 1}</button>
        </fieldset> : <div className="space-y-2">
          <h5 className="break-words">{index + 1}. {step.title}</h5><p className="whitespace-pre-wrap break-words">{step.description}</p>
          <p className="text-sm">{step.basis === 'source_obligation' ? 'Source-described obligation' : 'Recommendation'} · {step.dueOn ? `Due ${step.dueOn}` : 'Date unknown'}</p>
          <p className="text-sm">Responsible: {step.responsible.kind === 'specialist' ? `${step.responsible.alias} (proposed handoff)` : step.responsible.kind === 'person' ? step.responsible.userId === identity?.activeUserId ? 'Me' : 'Proposed person' : 'Not assigned'}</p>
          <p className="text-sm break-words">Sources: {step.sourceIds.map(sourceId => value.sources.find(source => source.reference.documentId === sourceId)?.title).filter(Boolean).join(', ') || 'No source cited'}</p>
          {step.dependencies.length > 0 && <p className="text-sm break-words">Depends on: {step.dependencies.map(dependency => value.steps.find(other => other.id === dependency)?.title).filter(Boolean).join(', ')}</p>}
          {renderTask?.(step)}
        </div>}
      </li>)}
    </ol>
    {onChange && <div className="flex flex-wrap gap-2"><button type="button" className="sd-btn sd-btn-sm" disabled={!editable || value.steps.length >= 50} onClick={add}>Add step</button>
      <button type="button" className="sd-btn sd-btn-sm" disabled={!editable} onClick={() => onChange(null)}>Remove document steps from this plan</button></div>}
  </section>;
}
