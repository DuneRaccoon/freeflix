#!/usr/bin/env python3
"""Generate the web app's install icons into frontend/public/icons/.

RUN BY HAND, NEVER BY A BUILD — the PNGs are committed, for the same reason as
make-tv-assets.py: Pillow and a serif face may not exist where the image is built.

The mark is the TV launcher's monogram (an ink tile, a gold hairline frame, a gold serif F),
imported from make-tv-assets.py so the two surfaces cannot drift apart. The maskable icon is
the one exception: Android crops it to a circle or squircle, and only the centre 80% is
guaranteed to survive, so it drops the frame (which sits at the very edge and would be cut
into arcs) and shrinks the F into the safe zone.

`manifest.test.ts` reads each PNG's real IHDR and compares it with the `sizes` the manifest
declares, so a size change here needs a manifest edit too.
"""
import importlib.util
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'frontend', 'public', 'icons')

# make-tv-assets.py has a hyphen in its name, so it cannot be imported the ordinary way.
_spec = importlib.util.spec_from_file_location('tv_assets', os.path.join(HERE, 'make-tv-assets.py'))
tv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tv)


def maskable(size, path):
    """Full-bleed ink, no frame, the F inside the 80% safe zone."""
    img = Image.new("RGB", (size, size), tv.INK)
    d = ImageDraw.Draw(img)
    inset = round(size * 0.2)
    tv.centred(d, (inset, inset, size - inset, size - inset), "F", tv.serif(round(size * 0.42)), tv.GOLD)
    img.save(path, "PNG", optimize=True)
    return img.size


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, size in [("icon-192.png", 192), ("icon-512.png", 512),
                       ("apple-touch-icon.png", 180), ("favicon-32.png", 32)]:
        print(f"{name:22}", tv.monogram(size, os.path.join(OUT, name)))
    print(f"{'maskable-512.png':22}", maskable(512, os.path.join(OUT, "maskable-512.png")))
