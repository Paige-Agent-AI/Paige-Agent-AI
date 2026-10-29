// Compatibility re-export: the ONE theme resolver now lives in
// supabase/functions/_shared/growth/theme.ts (moved there so the Deno edge imports it without the
// app module graph — EXP06 #3032 + the E09-proposed completion). Every existing import path keeps
// working; the definition is the _shared file.
export * from "../../../supabase/functions/_shared/growth/theme.ts";
