"""Inspect the existing native renderer's neutral proof; no product mutation.

Run with the bundled Python/pypdfium2/Pillow/pypdf runtime after the original
agreements-prepared-seal-proof.mts. PDFium independently renders the native PDF;
the first four blank fixture pages make misplaced ink observable.
"""
import hashlib
import json
from pathlib import Path
import sys

import pypdfium2 as pdfium
from pypdf import PdfReader

folder = Path(sys.argv[1]).resolve(strict=True)
pdf_path = folder / 'sealed.pdf'
reader = PdfReader(pdf_path)
assert len(reader.pages) == 6
doc = pdfium.PdfDocument(str(pdf_path))
observations = []
for index in range(len(doc)):
    page = doc[index]
    image = page.render(scale=1.25).to_pil().convert('RGB')
    target = folder / f'pdfium-{index + 1}.png'
    image.save(target)
    observation = {'page': index + 1, 'image_sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'size': list(image.size)}
    if index < 4:
        expected = (625, 875) if index % 2 == 0 else (875, 625)
        assert image.size == expected, (index, image.size)
        pixels = image.load()
        counts = [0] * 5
        outside = 0
        for y in range(image.height):
            for x in range(image.width):
                if max(pixels[x, y]) >= 160:
                    continue
                field = next((n for n in range(5) if 36 <= x <= 314 and (40 + n * 65) * 1.25 - 2 <= y <= (74 + n * 65) * 1.25 + 2), None)
                if field is None:
                    outside += 1
                else:
                    counts[field] += 1
        assert outside == 0, (index, outside)
        assert min(counts) > 10, (index, counts)
        text = reader.pages[index].extract_text()
        for required in ['/s/ Jordan Avery', 'JA', '2026-06-01T12:00:00.000Z', 'Approved scope']:
            assert required in text
        observation.update({'outside_reviewed_fields': outside, 'ink_per_field': counts, 'actual_text_preserved': True})
    observations.append(observation)
    page.close()
doc.close()
assert 'Signing record' in reader.pages[5].extract_text()
result = {'proof': 'INDEPENDENT_NATIVE_PDFIUM_RENDER_SYNTHETIC_DATA', 'observations': observations,
          'scope': 'six actual rendered pages; all four rotated crops contain ink only inside the reviewed fields; no authority, signing or customer acceptance'}
(folder / 'render-inspection.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print('PASS: six native PDFium pages; four exact rotated crops, all five fields, preserved text, no ink outside reviewed fields')
