import React from 'react';
import {
  MDXEditor, headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin,
  toolbarPlugin, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import './agreement-body-editor.css';

type Props = {
  /** Actual business/author/document revision identity; changes remount all editor state. */
  scopeKey: string;
  value: string;
  onChange: (value: string) => void;
  /** Temporary input lock while saving. Preserved records use the normal reader. */
  readOnly?: boolean;
};

/** The native Markdown remains canonical. No JSX/image execution or remote plugin. */
export function AgreementBodyEditor(props: Props) {
  return <ScopedBodyEditor key={props.scopeKey} {...props} />;
}
function ScopedBodyEditor({ value, onChange, readOnly = false }: Props) {
  const [view, setView] = React.useState<'document' | 'source'>('document');
  const [importFailed, setImportFailed] = React.useState(false);
  const [editorEpoch, setEditorEpoch] = React.useState(0);
  const authorInput = React.useRef(false);
  const alive = React.useRef(true);
  const editorFieldset = React.useRef<HTMLFieldSetElement>(null);
  const description = React.useId();
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  React.useEffect(() => {
    let frame: number | undefined;
    const restoreNativeMenuFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      const fieldset = editorFieldset.current;
      const menu = event.target instanceof Element ? event.target.closest('[role="listbox"]') : null;
      if (!fieldset?.isConnected || fieldset.disabled || !menu?.id) return;
      const trigger = Array.from(fieldset.querySelectorAll<HTMLButtonElement>('[role="combobox"][aria-expanded="true"]'))
        .find(control => control.getAttribute('aria-controls') === menu.id);
      if (!trigger) return;
      // The native menu is outside the editor event boundary and prevents close
      // autofocus. Observe only its own aria-controls pair; dismissal and the
      // original Sales leave guard remain authoritative.
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (!alive.current || editorFieldset.current !== fieldset || !fieldset.isConnected || fieldset.disabled
          || !trigger.isConnected || trigger.disabled || trigger.getAttribute('aria-expanded') !== 'false'
          || document.visibilityState === 'hidden') return;
        if (document.activeElement === document.body || menu.contains(document.activeElement)) trigger.focus({ preventScroll: true });
      });
    };
    document.addEventListener('keydown', restoreNativeMenuFocus, true);
    return () => { document.removeEventListener('keydown', restoreNativeMenuFocus, true); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, []);
  const chooseView = (next: 'document' | 'source') => {
    authorInput.current = false;
    if (next === 'document') { setImportFailed(false); setEditorEpoch(epoch => epoch + 1); }
    setView(next);
  };
  return <section className="e04-agreement-editor" aria-label="Agreement wording">
    <div className="e04-editor-view" role="group" aria-label="Agreement editing view">
      <button type="button" aria-pressed={view === 'document' && !importFailed} onClick={() => chooseView('document')}>Document</button>
      <button type="button" aria-pressed={view === 'source' || importFailed} onClick={() => chooseView('source')}>Text source</button>
    </div>
    {importFailed && <p role="alert" className="e04-editor-alert">Some document formatting could not be opened. Your wording is intact; you can continue editing the text below.</p>}
    {view === 'source' || importFailed
      ? <label className="e04-source-label">Agreement text source<textarea value={value} readOnly={readOnly} spellCheck aria-describedby={description} onChange={event => onChange(event.target.value)} /></label>
      : <fieldset ref={editorFieldset} disabled={readOnly} className="e04-editor-fieldset" aria-label="Agreement document editor" onBeforeInputCapture={() => { authorInput.current = true; }}
          onInputCapture={() => { authorInput.current = true; }}
          onPasteCapture={() => { authorInput.current = true; }}
          onCutCapture={() => { authorInput.current = true; }}
          onKeyDownCapture={event => { if (event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key)) authorInput.current = true; }}
          onPointerDownCapture={event => { if ((event.target as HTMLElement).closest('[role="toolbar"]')) authorInput.current = true; }}>
        <MDXEditor key={editorEpoch} markdown={value} trim={false} suppressHtmlProcessing readOnly={readOnly}
          contentEditableClassName="e04-agreement-prose"
          translation={(key, fallback, values = {}) => key === 'contentArea.editableMarkdown' ? 'Agreement content'
            : Object.entries(values).reduce((text, [name, value]) => text.split(`{{${name}}}`).join(String(value)), fallback)}
          onChange={(next, initialNormalization) => {
            // Merely opening retained wording must never save a normalized replacement.
            if (!readOnly && !initialNormalization && authorInput.current) onChange(next);
          }}
          onError={() => queueMicrotask(() => { if (alive.current) setImportFailed(true); })}
          plugins={[headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }), listsPlugin(), quotePlugin(), thematicBreakPlugin(),
            toolbarPlugin({ toolbarContents: () => <><UndoRedo /><BoldItalicUnderlineToggles options={['Bold', 'Italic']} /><BlockTypeSelect /><ListsToggle options={['bullet', 'number']} /></> })]} />
      </fieldset>}
    <p className="e04-editor-description" id={description}>Draft wording. Review the prepared document before requesting signatures.</p>
  </section>;
}
