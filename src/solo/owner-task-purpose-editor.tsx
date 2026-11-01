import { useEffect, useId, useRef, useState } from 'react';
import { ownerTaskEditableText, reviewedOwnerTaskRevision, type OwnerTaskReview, type OwnerTaskRevision } from './data/ownerTaskAutomation';
import './owner-task-purpose-editor.css';

/** Inline configuration only. Native control owns authority, CAS and persistence. */
export function OwnerTaskPurposeEditor({ review, actId, onCancel, onSave }: {
  review: OwnerTaskReview; actId: string; onCancel: () => void; onSave: (revision: OwnerTaskRevision) => void;
}) {
  const id = useId(), first = useRef<HTMLInputElement>(null);
  const step = review.acts.find(a => a.id === actId)!;
  const config = step.config && typeof step.config === 'object' && !Array.isArray(step.config)
    ? step.config as Record<string,unknown> : {};
  const [title,setTitle] = useState(ownerTaskEditableText(config.title,500) ? config.title : '');
  const [notes,setNotes] = useState(ownerTaskEditableText(config.description,10000) ? config.description : '');
  const revision: OwnerTaskRevision = {act_id:actId,config:{title,
    ...(Object.prototype.hasOwnProperty.call(config,'description') || notes !== '' ? {description:notes} : {})}};
  const valid = reviewedOwnerTaskRevision(review,revision) !== null;
  useEffect(()=>{first.current?.focus();},[]);
  return <form className="sa-editor sa-task-purpose-editor" aria-label={`Edit step ${String(step.position)}`}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onCancel();}}}
    onSubmit={event=>{event.preventDefault();if(valid)onSave(revision);}}>
    <div className="sa-field"><p className="sa-note">Correct this task in the original {review.process.state === 'paused' ? 'paused process' : 'draft'}. Other steps stay as saved. Saving does not enable the process or create work.</p></div>
    <div className="sa-field"><label htmlFor={`${id}-title`}>Task title</label>
      <input id={`${id}-title`} ref={first} value={title} onChange={event=>setTitle(event.target.value)} required aria-describedby={`${id}-guidance`} /></div>
    <div className="sa-field"><label htmlFor={`${id}-notes`}>Task notes (optional)</label>
      <textarea id={`${id}-notes`} rows={4} value={notes} onChange={event=>setNotes(event.target.value)} aria-describedby={`${id}-guidance`} />
      <p id={`${id}-guidance`} className="sa-note">{valid ? 'Use literal task instructions. Dynamic placeholders are not supported.'
        : 'Add a plain task title of up to 500 characters and notes of up to 10,000 characters. Dynamic placeholders and hidden control characters are unsupported.'}</p></div>
    <div className="sa-editor-foot"><button type="submit" className="sa-action" data-primary disabled={!valid}>Save changes</button>
      <button type="button" className="sa-ctl" onClick={onCancel}>Cancel</button></div>
  </form>;
}
