// "Put it on your website" — the code a business pastes into its own site to show a live form there
// (Experience 03). It is the same loader the booking calendar uses (public/embed.js, `data-form`), framing
// the published form at /form/<id>: answers come into Paige through the one public intake, from Paige's
// own origin, so they are filed, credited to a campaign and routed exactly as on the form's own page.
// Shown only for a live form; taking the form offline makes the copy on the site say it isn't available.
import React from "react";
import { embedFrameSnippet, embedOrigin, embedSnippet } from "./embed-code";


export function EmbedCode({ formId, formName }: { formId: string; formName?: string | null }) {
  // The tag by default; the frame on its own for a site that won't run a script tag (embed-code.ts).
  const [kind, setKind] = React.useState<"script" | "frame">("script");
  const origin = embedOrigin(window.location);
  const code = kind === "script" ? embedSnippet(origin, formId, formName) : embedFrameSnippet(origin, formId, formName);
  const [copy, setCopy] = React.useState<"idle" | "copied" | "failed">("idle");
  const codeRef = React.useRef<HTMLElement | null>(null);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopy("copied");
    } catch {
      // A browser that refuses the clipboard still lets the owner copy by hand: select the code for them.
      const el = codeRef.current;
      const sel = window.getSelection();
      if (el && sel) { const range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range); }
      setCopy("failed");
    }
  };
  return (
    <section className="vs-embed" aria-labelledby={`vs-embed-${formId}`}>
      <h3 id={`vs-embed-${formId}`}>Put it on your website</h3>
      <p>Paste this code where the form should appear on a page of your site.{kind === "script" ? " It fits the space it's given, and answers" : " Answers"} come into Paige exactly as they do on the form's own page.</p>
      <pre className="vs-code" tabIndex={0} role="region" aria-label="Embed code"><code ref={codeRef}>{code}</code></pre>
      <div className="vs-embed-row">
        <button type="button" className="vs-btn" onClick={() => void onCopy()}>{copy === "copied" ? "Copied" : "Copy code"}</button>
        <p className="vs-embed-status" role="status">
          {copy === "copied" ? "Paste it into your site's page editor." : copy === "failed" ? "Your browser didn't allow copying. The code is selected: copy it with your keyboard." : ""}
        </p>
      </div>
      {kind === "frame" ? (
        <p>This version can't resize to fit the form or carry your campaign links' tags. Use the first code wherever your site allows it. <button type="button" className="vs-link" onClick={() => { setKind("script"); setCopy("idle"); }}>Use the first code</button></p>
      ) : (
        <p>Site won't run this code? <button type="button" className="vs-link" onClick={() => { setKind("frame"); setCopy("idle"); }}>Get a version without a script</button></p>
      )}
      <p>If you unpublish the form, your site shows that it isn't available.</p>
    </section>
  );
}
