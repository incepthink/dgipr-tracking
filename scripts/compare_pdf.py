"""Renders a generated PDF and the reference PDF to PNG and builds per-page comparison images:
side-by-side (reference | generated) and an overlay (reference in red, generated in blue).

Usage: python scripts/compare_pdf.py GENERATED.pdf REFERENCE.pdf OUT_DIR [--dpi 110]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pymupdf


def to_pix(page: pymupdf.Page, dpi: int) -> pymupdf.Pixmap:
    return page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("generated")
    ap.add_argument("reference")
    ap.add_argument("out")
    ap.add_argument("--dpi", type=int, default=110)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    gen, ref = pymupdf.open(a.generated), pymupdf.open(a.reference)
    print(f"pages: generated={gen.page_count} reference={ref.page_count}")
    for i in range(max(gen.page_count, ref.page_count)):
        g = gen[i] if i < gen.page_count else None
        r = ref[i] if i < ref.page_count else None
        if g is not None:
            print(f"page {i + 1}: generated size {g.rect.width:.2f}x{g.rect.height:.2f}pt")
        if g is None or r is None:
            print(f"page {i + 1}: missing in {'generated' if g is None else 'reference'}")
            continue
        gp, rp = to_pix(g, a.dpi), to_pix(r, a.dpi)
        w, h = rp.width, rp.height
        # side by side
        doc = pymupdf.open()
        page = doc.new_page(width=w * 2 + 10, height=h)
        page.insert_image(pymupdf.Rect(0, 0, w, h), pixmap=rp)
        page.insert_image(pymupdf.Rect(w + 10, 0, 2 * w + 10, h), pixmap=gp)
        page.get_pixmap().save(out / f"page{i + 1}_side_by_side.png")
        # overlay: red = reference ink, blue = generated ink, black/purple = both
        ov = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), False)
        rs, gs = rp.samples, gp.samples
        buf = bytearray(w * h * 3)
        gw = gp.width
        for y in range(h):
            for x in range(w):
                rv = rs[y * w + x]
                gv = gs[y * gw + x] if x < gw and y < gp.height else 255
                o = (y * w + x) * 3
                buf[o], buf[o + 1], buf[o + 2] = gv, min(rv, gv), rv
        ov.set_rect(ov.irect, (255, 255, 255))
        ov = pymupdf.Pixmap(pymupdf.csRGB, w, h, bytes(buf), False)
        ov.save(out / f"page{i + 1}_overlay.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
