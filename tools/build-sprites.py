#!/usr/bin/env python3
"""Generate the served sprite set in public/img/ from the masters in assets/logan/src/.

Masters are already cleaned and trimmed; this script only sizes, pads and compresses.
Run from the app/ folder:  python3 tools/build-sprites.py
"""
from PIL import Image
import os, glob

SRC, OUT = "assets/logan/src", "public/img"
PAD = 0.03
PLAN = {
    "logan-rest": 384, "logan-go": 384, "logan-pr": 320, "logan-celebrate": 448,
    "logan-plan": 384, "logan-thinking": 384,
    "head-ready": 128, "head-tired": 128, "head-pumped": 128, "head-focused": 128,
    "logan-mark": 192, "logan-mark-maskable": 384,
}

def fit(im, target, pad=PAD):
    box = int(target * (1 - 2 * pad)); w, h = im.size
    s = min(box / w, box / h)
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    c = Image.new("RGBA", (target, target), (0, 0, 0, 0))
    c.paste(im, ((target - im.width) // 2, (target - im.height) // 2), im)
    return c

def save(im, path):
    tmp = path.replace(".png", "__q.png")
    im.quantize(colors=256, method=Image.FASTOCTREE).save(tmp, optimize=True)
    im.save(path, optimize=True)
    if os.path.getsize(tmp) < os.path.getsize(path):
        os.replace(tmp, path)
    else:
        os.remove(tmp)

os.makedirs(OUT, exist_ok=True)
masters = {}
for f in sorted(glob.glob(f"{SRC}/*.png")):
    name = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f).convert("RGBA")
    masters[name] = im
    save(fit(im, PLAN.get(name, 384)), f"{OUT}/{name}.png")

head, badge = masters["head-ready"], masters["logan-mark"]
save(fit(head, 192), f"{OUT}/icon-192.png")
save(fit(head, 512), f"{OUT}/icon-512.png")
save(fit(head, 180), f"{OUT}/apple-touch-icon.png")
m = Image.new("RGBA", (512, 512), (244, 243, 240, 255))
h = fit(head, 512, pad=0.22)
m.paste(h, (0, 0), h)
save(m, f"{OUT}/icon-maskable-512.png")
for s in (32, 64):
    save(fit(badge, s, pad=0.02), f"{OUT}/favicon-{s}.png")

total = sum(os.path.getsize(x) for x in glob.glob(f"{OUT}/*.png"))
print(f"built {len(glob.glob(f'{OUT}/*.png'))} files, {total // 1024}KB total")
