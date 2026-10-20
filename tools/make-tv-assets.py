#!/usr/bin/env python3
"""Generate the three webOS launcher assets at the exact sizes `appinfo.json` declares.

RUN BY HAND, NEVER BY A BUILD. The PNGs are committed; this script exists so they are
reproducible rather than mysterious. It needs Pillow and a serif face, which a CI box may not
have — which is the whole reason the output is committed and this is not a build step.

IT LIVES OUTSIDE `webos/` BECAUSE `ares-package` PACKAGES THAT WHOLE DIRECTORY. The shell is
five files; a sixth would be shipped inside the IPK and installed on the television, and
`webosShell.test.ts` asserts the directory holds exactly those five so the next helper does not
quietly end up on the set.

The sizes are not decoration: webOS wants icon 80x80 and largeIcon 130x130 (spec 3.3), and
`appinfoAssets.test.ts` reads each PNG's real IHDR and compares it against what the manifest
claims, so a resize here without a manifest edit fails that guard.

Colours are the TV surface's own tokens, copied from frontend/public/bigscreen.css:2-9 — copied
and not imported, exactly as bigscreen.css itself copies globals.css, because this file is
outside every build that could resolve a custom property.
"""
from PIL import Image, ImageDraw, ImageFont
import os, sys

INK   = (0x0A, 0x0A, 0x0B)
GOLD  = (0xC9, 0xA8, 0x6A)
TEXT  = (0xF4, 0xF1, 0xEA)
OUT   = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'webos')

SERIF_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
]

def serif(size):
    for p in SERIF_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    # No geometric fallback: a wordmark drawn in PIL's 11px bitmap font would ship as the app's
    # face. Better to refuse and leave the committed PNGs alone.
    sys.exit("no serif face found; the committed PNGs are the artefact — leave them in place")

def centred(draw, box, text, font, fill, tracking=0):
    x0, y0, x1, y1 = box
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    asc, desc = font.getmetrics()
    x = x0 + (x1 - x0 - total) / 2
    y = y0 + (y1 - y0 - (asc + desc)) / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking

def monogram(size, path):
    """The launcher mark: an ink tile, a gold hairline frame, a gold serif F."""
    img = Image.new("RGB", (size, size), INK)
    d = ImageDraw.Draw(img)
    pad = max(2, round(size * 0.075))
    r = max(3, round(size * 0.16))
    d.rounded_rectangle([pad, pad, size - pad - 1, size - pad - 1],
                        radius=r, outline=GOLD, width=max(1, round(size * 0.025)))
    centred(d, (pad, pad, size - pad, size - pad), "F", serif(round(size * 0.62)), GOLD)
    img.save(path, "PNG", optimize=True)
    return img.size

def splash(path):
    """1920x1080. The wordmark, a rule under it, and nothing that needs a network."""
    w, h = 1920, 1080
    img = Image.new("RGB", (w, h), INK)
    d = ImageDraw.Draw(img)
    centred(d, (0, 0, w, h - 40), "FREEFLIX", serif(132), TEXT, tracking=18)
    d.rectangle([w // 2 - 190, h // 2 + 96, w // 2 + 190, h // 2 + 98], fill=GOLD)
    img.save(path, "PNG", optimize=True)
    return img.size

if __name__ == "__main__":
    print("icon.png     ", monogram(80, os.path.join(OUT, "icon.png")))
    print("largeIcon.png", monogram(130, os.path.join(OUT, "largeIcon.png")))
    print("splash.png   ", splash(os.path.join(OUT, "splash.png")))
