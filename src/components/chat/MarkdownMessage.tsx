import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { APP_HOST, MARKETING_HOST, isMarketingOnlyRoute } from "@/lib/hostRouting";
import { PAIGE_APP_ORIGIN } from "../../../supabase/functions/_shared/canonical-app-url";

interface MarkdownMessageProps {
  content: string;
  className?: string;
  /** Present only for scoped workspace answers; paths come from the canonical record resolver. */
  verifiedAppPaths?: readonly string[];
  /** Private answers may show image captions without initiating media requests.
   * Explicit authorized file controls and existing workspace callers are separate. */
  allowImages?: boolean;
}

function verifiedHref(href: string | undefined, paths: readonly string[] | undefined): string | null {
  if (!href) return null;
  if (paths === undefined || href.startsWith("#")) return href;
  try {
    const url = new URL(href, PAIGE_APP_ORIGIN);
    const host = url.hostname.replace(/\.$/, "");
    // External citations retain the existing Markdown policy. App addresses require
    // a current-account target from the same native references as the visible link row.
    if (![MARKETING_HOST, `www.${MARKETING_HOST}`, APP_HOST].includes(host)) return href;
    // The existing host router owns public-site classification too. Preserve
    // real public citations without admitting app navigation from model prose.
    if (isMarketingOnlyRoute(url.pathname) || (host !== APP_HOST && url.pathname === "/")) return href;
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return paths.includes(path) ? path : null;
  } catch { return null; }
}

/**
 * Renders Paige's chat messages as styled markdown.
 * Supports: bold, italic, headings, ordered/unordered lists,
 * code, blockquotes, links, and GFM tables.
 */
export function MarkdownMessage({ content, className, verifiedAppPaths, allowImages = true }: MarkdownMessageProps) {
  return (
    <div
      className={cn(
        "text-[13px] sm:text-sm leading-relaxed text-foreground break-words",
        // Inline element styling
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_em]:italic",
        // Headings
        "[&_h1]:text-base [&_h1]:sm:text-lg [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-foreground",
        "[&_h2]:text-sm [&_h2]:sm:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-foreground",
        "[&_h3]:text-[13px] [&_h3]:sm:text-sm [&_h3]:font-semibold [&_h3]:mt-2.5 [&_h3]:mb-1 [&_h3]:text-foreground",
        // Paragraphs & spacing
        "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        // Lists
        "[&_ul]:my-1.5 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1",
        "[&_ol]:my-1.5 [&_ol]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1",
        "[&_li]:leading-relaxed [&_li>p]:my-0",
        "[&_li>ul]:my-1 [&_li>ol]:my-1",
        // Links
        "[&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80",
        verifiedAppPaths === undefined ? "[&_a]:text-accent" : "[&_a]:text-foreground",
        // Code
        "[&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:text-[12px] [&_code]:font-mono",
        "[&_pre]:my-2 [&_pre]:p-2.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:overflow-x-auto",
        "[&_pre>code]:bg-transparent [&_pre>code]:p-0",
        // Blockquote
        "[&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:my-2",
        // Tables (GFM) — the table self-scrolls inside its own wrapper (see the `table` override
        // below), so a wide table is reachable, never clipped, under a transcript that hides its own
        // horizontal overflow. Vertical margin lives on that wrapper, not the table.
        "[&_table]:w-full [&_table]:border-collapse [&_table]:text-[12px] [&_table]:sm:text-[13px]",
        "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_th]:text-left [&_th]:font-semibold",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        // Horizontal rule
        "[&_hr]:my-3 [&_hr]:border-border",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...(!allowImages ? {img: ({alt}: {alt?: string}) =>
            <span className="text-muted-foreground">{alt ? `Image omitted: ${alt}` : "Image omitted"}</span>} : {}),
          a: ({ node, href, children, ...props }) => {
            const verified = verifiedHref(href, verifiedAppPaths);
            return verified
              ? <a {...props} href={verified} target="_blank" rel="noopener noreferrer">{children}</a>
              : <span>{children}</span>;
          },
          // A wide GFM table is genuinely wide content: it self-scrolls in its own container so every
          // column stays reachable, even under a transcript that hides its own horizontal overflow
          // (the skill's wide-content pattern — never hidden/clipped).
          table: ({ node, ...props }) => (
            <div className="my-2 max-w-full overflow-x-auto">
              <table {...props} />
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
