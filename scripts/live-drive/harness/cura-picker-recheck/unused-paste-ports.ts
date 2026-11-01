// This picker-only frame does not exercise paste/drop or initialize the staff uploader.
export function transferFiles():never{throw new Error("Paste is outside this picker-only frame.");}
export function hasFileDrag():never{throw new Error("Drop is outside this picker-only frame.");}
