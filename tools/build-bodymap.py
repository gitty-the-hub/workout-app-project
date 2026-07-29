#!/usr/bin/env python3
"""Build public/img/bodymap.svg from the generated anatomy art.

The art (public/img/body-front.png / body-back.png) draws every muscle as a closed
outlined cell. Rather than hand-guessing overlay shapes, this script segments those
cells and traces them, so each highlighted region follows the drawing exactly.

Pipeline: threshold ink -> label enclosed cells -> keep cells over a min area ->
trace contours -> simplify -> group by muscle key using MAP below -> emit SVG.

Cell numbers come from the numbered debug render (tools/build-bodymap.py --debug),
which is how MAP was authored. Re-run --debug if the art is ever regenerated.

Run from the app/ folder:  python3 tools/build-bodymap.py
"""
import sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure

SRC = {"front": "public/img/body-front.png", "back": "public/img/body-back.png"}
OUT = "public/img/bodymap.svg"
MIN_AREA = 250
INK = 110
GAP = 40                      # gap between the two figures in the output
SIMPLIFY = 1.2                # contour simplification tolerance in px

# ---- cell -> muscle keys (a cell may serve more than one key) ----------------
MAP = {
"front": {
  "neck": [2,3,4,5,6],
  "traps": [7,8],
  "anterior-deltoid": [9,10],
  "lateral-deltoid": [9,10],
  "upper-chest": [11,12,13,14],
  "chest": [15,16],
  "biceps": [17,18,19,20],
  "forearms": [32,33,38,39,41,42,43,44,47,48,49,50,52],
  "obliques": [21,22,23,26,27,28,29,30,31,34,35,40],
  "core": [24,25,36,37,45,46,51],
  "hip-flexors": [53,54,57,58],
  "adductors": [65,66,69,70],
  "quads": [55,56,59,60,67,68,71,72,73,74,75],
  "calves": [76,77,78,79,80,81],
  "glutes": [],
},
"back": {
  "traps": [2,3,4,5],
  "upper-back": [4,5,10,11],
  "posterior-deltoid": [6,7,8,9],
  "lateral-deltoid": [6,7],
  "rotator-cuff": [10,11,12,13],
  "lats": [16,18,19,21],
  "obliques": [33,34,35,36],
  "lower-back": [23,24,40,41],
  "triceps": [14,15,17,20,22,25,26],
  "forearms": [27,28,29,30,31,32,37,38,39],
  "glutes": [42,43,44,45],
  "hamstrings": [46,47,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,68],
  "calves": [67,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83],
},
}

def segment(path):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    alpha = a[..., 3] > 0
    b = a[..., :3].astype(int).mean(axis=2)
    cells = alpha & ~((b < INK) & alpha)
    lab, n = ndimage.label(cells)
    sizes = ndimage.sum(cells, lab, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s > MIN_AREA]
    return im.size, lab, {i + 1: old for i, old in enumerate(keep)}   # display id -> label id

def trace(lab, label_id, dx=0):
    """largest contour of one cell, simplified, as an SVG path string"""
    m = (lab == label_id)
    if not m.any():
        return None
    pad = np.pad(m, 1, constant_values=False)
    cs = measure.find_contours(pad.astype(float), 0.5)
    if not cs:
        return None
    c = max(cs, key=len)
    c = measure.approximate_polygon(c, tolerance=SIMPLIFY)
    pts = [(round(x - 1 + dx, 1), round(y - 1, 1)) for y, x in c]
    if len(pts) < 3:
        return None
    d = f"M{pts[0][0]} {pts[0][1]}" + "".join(f"L{x} {y}" for x, y in pts[1:]) + "Z"
    return d

def debug_render():
    for name, path in SRC.items():
        size, lab, ids = segment(path)
        im = Image.open(path).convert("RGBA")
        canvas = Image.new("RGB", size, (255, 255, 255))
        canvas.paste(im, (0, 0), im)
        canvas = canvas.resize((size[0] * 2, size[1] * 2), Image.LANCZOS)
        d = ImageDraw.Draw(canvas)
        for disp, real in ids.items():
            ys, xs = (lab == real).nonzero()
            d.text((xs.mean() * 2 - 7, ys.mean() * 2 - 9), str(disp), fill=(200, 0, 0))
        canvas.save(f"/tmp/cells-{name}.png")
        print(f"/tmp/cells-{name}.png  ({len(ids)} cells)")

def main():
    if "--debug" in sys.argv:
        return debug_render()

    parts, W, H = [], 0, 0
    for i, (name, path) in enumerate(SRC.items()):
        (w, h), lab, ids = segment(path)
        dx = 0 if name == "front" else w + GAP
        W = max(W, dx + w); H = max(H, h)
        groups = []
        used = set()
        for key, cells in MAP[name].items():
            paths = []
            for disp in cells:
                real = ids.get(disp)
                if real is None:
                    print(f"  warn: {name} cell {disp} does not exist")
                    continue
                d = trace(lab, real, dx)
                if d:
                    paths.append(d)
                    used.add(disp)
            if paths:
                groups.append(f'  <g data-m="{key}">' + "".join(f'<path d="{p}"/>' for p in paths) + "</g>")
        unmapped = sorted(set(ids) - used)
        print(f"{name}: {len(ids)} cells, {len(unmapped)} unmapped (head/hands/feet expected): {unmapped}")
        parts.append(
            f'<g id="{name}">\n'
            f'  <image class="art-light" href="img/body-{name}.png" x="{dx}" y="0" width="{w}" height="{h}"/>\n'
            f'  <image class="art-dark" href="img/body-{name}-dark.png" x="{dx}" y="0" width="{w}" height="{h}"/>\n'
            + "\n".join(groups) + "\n"
            f'  <text x="{dx + w/2}" y="{h + 30}" text-anchor="middle">{"FRENTE" if name=="front" else "ESPALDA"}</text>\n'
            f'</g>')

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H + 42}" id="bodymap">
<!-- GENERATED by tools/build-bodymap.py — do not edit by hand.
     Regions are traced from the anatomy art itself, so highlights follow the drawing.
     Each group carries data-m="<muscle key>"; the app adds m-primary / m-secondary. -->
<style>
  /* two artworks, one per theme: the host page shows one and hides the other.
     No blend modes and no CSS filters — both proved unreliable on iOS Safari. */
  #bodymap .art-dark {{ display: none; }}
  #bodymap g[data-m] path {{ fill: transparent; transition: fill .2s ease; }}
  #bodymap g[data-m].m-secondary path {{ fill: var(--bm-secondary, #C29B6E); fill-opacity: .55; }}
  #bodymap g[data-m].m-primary   path {{ fill: var(--bm-primary, #5F7043); fill-opacity: .6; }}
  #bodymap text {{ font: 600 22px "Oswald", sans-serif; fill: var(--bm-label, #8a8378); letter-spacing: .1em; }}
</style>
{chr(10).join(parts)}
</svg>
'''
    open(OUT, "w", encoding="utf-8").write(svg)
    import os
    print(f"wrote {OUT} — {os.path.getsize(OUT)//1024}KB")

if __name__ == "__main__":
    main()
