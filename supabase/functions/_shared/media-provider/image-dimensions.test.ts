// deno test --allow-read supabase/functions/_shared/media-provider/image-dimensions.test.ts
// EXP07 row 3: the dimensions recorded on a generated image come from the bytes themselves —
// PNG IHDR, JPEG SOF, WebP VP8X/VP8L/VP8 headers — never from the prompt or the model name.
// Every fixture below is a real minimal header shape; an unparseable byte stream must record
// null, never a guess.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { imageDimensions } from "./complete.ts";

/** A minimal PNG: signature + IHDR chunk with big-endian width/height. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  bytes.set([0, 0, 0, 13], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const be32 = (at: number, value: number) => {
    bytes[at] = (value >>> 24) & 0xff; bytes[at + 1] = (value >>> 16) & 0xff;
    bytes[at + 2] = (value >>> 8) & 0xff; bytes[at + 3] = value & 0xff;
  };
  be32(16, width);
  be32(20, height);
  return bytes;
}

/** A minimal JPEG: SOI, one APP0 segment (length 4 = its own length bytes + 2 payload, skipped by
 *  the walk), then SOF0 with big-endian height/width. The walk lands on the SOF at offset 8. */
function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(8 + 2 + 2 + 1 + 2 + 2 + 3);
  bytes.set([0xff, 0xd8], 0);           // SOI
  bytes.set([0xff, 0xe0], 2);           // APP0 marker
  bytes.set([0, 4], 4);                 // segment length 4 (length bytes + 2 payload)
  bytes[6] = 0; bytes[7] = 0x10;        // APP0 payload (skipped)
  bytes.set([0xff, 0xc0], 8);           // SOF0 marker — where the walk arrives
  bytes[10] = 0; bytes[11] = 8;         // SOF segment length
  bytes[12] = 8;                        // sample precision
  bytes[13] = (height >> 8) & 0xff; bytes[14] = height & 0xff;
  bytes[15] = (width >> 8) & 0xff; bytes[16] = width & 0xff;
  return bytes;
}

/** A minimal WebP VP8X container: RIFF/WEBP + chunk tag + 24-bit LE canvas size minus one. */
function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const le24 = (at: number, value: number) => {
    bytes[at] = value & 0xff; bytes[at + 1] = (value >> 8) & 0xff; bytes[at + 2] = (value >> 16) & 0xff;
  };
  le24(24, width - 1);
  le24(27, height - 1);
  return bytes;
}

Deno.test("png dimensions read from IHDR", () => {
  assertEquals(imageDimensions(png(1024, 1024)), { width: 1024, height: 1024 });
  assertEquals(imageDimensions(png(1440, 900)), { width: 1440, height: 900 });
});

Deno.test("jpeg dimensions read from the first SOF after skipped segments", () => {
  assertEquals(imageDimensions(jpeg(512, 768)), { width: 512, height: 768 });
});

Deno.test("webp dimensions read from the VP8X canvas", () => {
  assertEquals(imageDimensions(webpVp8x(640, 480)), { width: 640, height: 480 });
});

Deno.test("unparseable bytes record null, never a guess", () => {
  assertEquals(imageDimensions(new Uint8Array([1, 2, 3])), null);
  assertEquals(imageDimensions(new Uint8Array(64)), null); // no signature
  const truncated = png(100, 100).slice(0, 12);            // PNG signature without IHDR body
  assertEquals(imageDimensions(truncated), null);
  assertEquals(imageDimensions(new Uint8Array(0)), null);
});
