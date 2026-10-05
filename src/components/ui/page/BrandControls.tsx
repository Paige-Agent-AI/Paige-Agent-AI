import { useEffect, useRef, useState, type CSSProperties } from "react";
import { UploadCloud, Loader2, Check, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useBrandFontFaces } from "@/hooks/useBrandFontFaces";
import {
  BRAND_FONTS, BRAND_FONT_CHARACTERS, PREVIEW_FONT_WEIGHTS, brandFontStack, lookupBrandFont, resolveBrandFontPair,
  type BrandFontFace,
} from "@/lib/brand-fonts";
import { useToast } from "@/hooks/use-toast";
import { contrastRatio, isValidHex } from "@/lib/brand/resolveBrand";
import { cn } from "@/lib/utils";

/**
 * Shared brand-authoring primitives (§11 "add to the layer, don't fork").
 *
 * ColorField (swatch + hex + AA-contrast chip) and LogoUploader (drag/drop image
 * uploader) were lifted out of BrandKitPanel so Client Portal and the Brand Kit
 * editor drive the exact same controls — one source of truth for how a tenant
 * picks a color or drops a logo. Neutral primitives: no vertical/finance content,
 * gold reserved for the act moment upstream (these controls never wear gold).
 */

/** The typeface options offered before the self-hosted library. Every family here (bar "System
 *  default", stored as "") resolves in src/lib/brand-fonts.ts, so a value saved from this list keeps
 *  working; the live picker is BrandFontPicker below. */
export const FONT_OPTIONS = [
  "System default", "Inter", "Plus Jakarta Sans", "Poppins", "Montserrat",
  "Playfair Display", "Lora", "Source Serif 4", "DM Sans", "Space Grotesk",
];

const MAX_BYTES = 2 * 1024 * 1024;
export const BRAND_IMG_TYPES = [
  "image/png", "image/svg+xml", "image/webp", "image/jpeg",
  "image/x-icon", "image/vnd.microsoft.icon",
];

/**
 * Drag/drop (or click) image uploader for a brand asset. Generic over the asset
 * `kind` so callers can wire it to any keyed upload handler (e.g. useBrandKit's
 * setLogo/clearLogo, typed with LogoKind). Validates type + size, toasts on
 * failure, and shows a spinner while the upstream upload runs.
 */
export function LogoUploader<K extends string>({
  label, hint, kind, url, onUpload, onClear, busy, square,
}: {
  label: string;
  hint: string;
  kind: K;
  url: string | null;
  onUpload: (kind: K, file: File) => Promise<void>;
  onClear: (kind: K) => Promise<void>;
  busy: boolean;
  square?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    if (!BRAND_IMG_TYPES.includes(file.type)) {
      toast({ title: "Unsupported file", description: "Use a PNG, SVG, WEBP, JPG, or ICO.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: "Keep it under 2 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      await onUpload(kind, file);
      toast({ title: `${label} updated` });
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {url && (
          <button
            type="button"
            onClick={() => void onClear(kind)}
            disabled={busy || uploading}
            className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void handleFile(e.dataTransfer.files?.[0]); }}
        disabled={uploading || busy}
        className={cn(
          "group relative flex w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-[conic-gradient(at_center,_hsl(var(--muted))_0deg,_transparent_90deg,_hsl(var(--muted))_180deg,_transparent_270deg)] bg-[length:16px_16px] transition-colors hover:border-[hsl(var(--ring))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
          square ? "h-24 w-24" : "h-24 w-full",
        )}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        ) : url ? (
          <img src={url} alt={label} className="max-h-[84%] max-w-[84%] object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-muted-foreground">
            <UploadCloud className="h-5 w-5" />
            <span className="text-xs">Drop or click</span>
          </span>
        )}
      </button>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <input
        ref={inputRef} type="file" accept={BRAND_IMG_TYPES.join(",")} className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
    </div>
  );
}

/**
 * A color swatch + hex input with an optional AA-contrast readout. The swatch is
 * a native color picker tucked behind a bordered chip; the hex mirrors it both
 * ways. Falls back to `floor` when the current value isn't a valid 6-digit hex.
 */
export function ColorField({
  label, value, floor, onChange, contrastAgainst, contrastLabel,
}: {
  label: string;
  value: string;
  floor: string;
  onChange: (v: string) => void;
  contrastAgainst?: string;
  contrastLabel?: string;
}) {
  const hex = isValidHex(value) ? value : floor;
  const ratio = contrastAgainst ? contrastRatio(hex, contrastAgainst) : null;
  const lowContrast = ratio != null && ratio < 4.5;
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border" style={{ background: hex }}>
          <input
            type="color" value={hex} onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`${label} color picker`}
          />
        </label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder={floor}
          spellCheck={false}
          className="font-mono uppercase"
        />
      </div>
      {ratio != null && (
        <p className={cn("flex items-center gap-1 text-xs", lowContrast ? "text-[hsl(var(--warning))]" : "text-muted-foreground")}>
          {lowContrast ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />}
          {contrastLabel} contrast {ratio.toFixed(1)}:1 {lowContrast ? "— may be hard to read" : "— AA pass"}
        </p>
      )}
    </div>
  );
}

const SYSTEM_DEFAULT = "System default";
// The shared SelectItem highlights the active row with the accent fill, which is gold here; on this
// surface a highlighted row is a resting state, not the act (§11), so it reads on the neutral layer.
const FONT_ITEM = "focus:bg-muted focus:text-foreground";
// Display faces differ widely in x-height (Libre Caslon Display's is small, Anton's is tall), so at one
// font-size their names read at very different sizes. font-size-adjust scales each face to the same
// x-height (0.52 of the em, close to the UI sans), so every option reads at a similar size.
const optionStyle = (face: BrandFontFace): CSSProperties => ({ fontFamily: brandFontStack(face), fontSizeAdjust: "0.52" });

/** One character group. Its faces (regular cut only) load when the group first scrolls into view inside
 *  the open list, so opening the picker never downloads the whole library at once. */
function FontGroup({ label, faces }: { label: string; faces: readonly BrandFontFace[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    // While the list is closed, Radix keeps its items in a detached fragment (so the trigger can show
    // the selected label): not connected, never "seen", nothing loads.
    if (!node || seen || !node.isConnected) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    });
    io.observe(node);
    return () => io.disconnect();
  }, [seen]);
  useBrandFontFaces(ref, seen ? faces : [], PREVIEW_FONT_WEIGHTS);
  return (
    <SelectGroup ref={ref}>
      <SelectSeparator />
      <SelectLabel className="text-xs font-medium text-muted-foreground">{label}</SelectLabel>
      {faces.map((f) => (
        <SelectItem key={f.slug} className={FONT_ITEM} value={f.family}>
          <span style={optionStyle(f)}>{f.family}</span>
        </SelectItem>
      ))}
    </SelectGroup>
  );
}

/**
 * The brand typeface picker (Operate surface). Offers the self-hosted library grouped by character,
 * each option drawn in its own face, plus the classic picks. Stores ONLY the family name in the existing
 * `brand.font` key ("" for System default) — the body face is derived from the library's pairing, so
 * there is no second stored value. A stored value outside the library is shown as-is and kept until the
 * owner picks something else; it is never turned into a font URL.
 *
 * Faces load lazily and only their regular cut: the selected face at mount, then each character group as
 * it scrolls into view in the open list.
 */
export function BrandFontPicker({
  id, value, onChange, disabled,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const current = (value ?? "").trim();
  const face = lookupBrandFont(current);
  const unknown = current && !face ? current : null;
  const pair = resolveBrandFontPair(current);
  const rootRef = useRef<HTMLDivElement>(null);
  useBrandFontFaces(rootRef, face ? [face] : [], PREVIEW_FONT_WEIGHTS);

  const selectValue = face ? face.family : unknown ?? SYSTEM_DEFAULT;
  const hintId = `${id}-hint`;
  const hint = pair
    ? pair.display.slug === pair.body.slug
      ? `Headings and body text use ${pair.display.family}.`
      : `Headings use ${pair.display.family}; body text uses ${pair.body.family}.`
    : unknown
      ? `${unknown} isn't in the font library, so pages show it only where a visitor has it installed. Pick a library face to load it for everyone.`
      : "Your pages use the visitor's system typeface.";

  return (
    <div ref={rootRef} className="space-y-1.5">
      <Select
        value={selectValue}
        disabled={disabled}
        onValueChange={(v) => onChange(v === SYSTEM_DEFAULT ? "" : v)}
      >
        <SelectTrigger id={id} aria-describedby={hintId}>
          <SelectValue placeholder={SYSTEM_DEFAULT} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem className={FONT_ITEM} value={SYSTEM_DEFAULT}>{SYSTEM_DEFAULT}</SelectItem>
          {unknown && (
            <SelectItem className={FONT_ITEM} value={unknown}>{unknown}</SelectItem>
          )}
          {BRAND_FONT_CHARACTERS.map(({ key, label }) => {
            const faces = BRAND_FONTS.filter((f) => f.character === key);
            return faces.length ? <FontGroup key={key} label={label} faces={faces} /> : null;
          })}
        </SelectContent>
      </Select>
      <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
