#!/usr/bin/env python3
"""Convert the exercise master list (markdown table) into public/data/exercises.json.

Source: docs/exercise-catalog-source.md — a normalized 200-row catalog with canonical
names, aliases, equipment, movement pattern, muscles and difficulty.

The report writes muscles as prose ("anterior delts", "Rectus abdominis", "mid-back").
Those ~90 labels are folded onto MUSCLE_KEYS — the fixed vocabulary the SVG body map
renders. Anything unmapped is reported loudly rather than silently dropped.

Run from the app/ folder:  python3 tools/build-exercises.py
"""
import json, re, sys, unicodedata
from pathlib import Path

SRC = Path("docs/exercise-catalog-source.md")
OUT = Path("public/data/exercises.json")

# --- the vocabulary the body map knows how to colour -------------------------
MUSCLE_KEYS = [
    "chest", "upper-chest", "anterior-deltoid", "lateral-deltoid", "posterior-deltoid",
    "triceps", "biceps", "forearms", "lats", "upper-back", "traps", "lower-back",
    "core", "obliques", "glutes", "quads", "hamstrings", "adductors", "calves",
    "hip-flexors", "rotator-cuff", "neck",
]

# prose label (lowercased) -> canonical key
MUSCLE_MAP = {
    "chest": "chest", "lower chest": "chest",
    "upper chest": "upper-chest",
    "shoulders": "anterior-deltoid", "delts": "anterior-deltoid",
    "anterior delts": "anterior-deltoid",
    "lateral delts": "lateral-deltoid",
    "rear delts": "posterior-deltoid",
    "rotator cuff": "rotator-cuff", "external rotators": "rotator-cuff",
    "triceps": "triceps", "triceps long head": "triceps",
    "biceps": "biceps", "brachialis": "biceps",
    "forearms": "forearms", "brachioradialis": "forearms",
    "forearm extensors": "forearms", "grip": "forearms",
    "lats": "lats", "teres major": "lats",
    "back": "upper-back", "upper back": "upper-back", "mid-back": "upper-back",
    "rhomboids": "upper-back",
    "traps": "traps", "upper traps": "traps",
    "lower back": "lower-back", "erectors": "lower-back",
    "core": "core", "rectus abdominis": "core", "upper abs": "core",
    "lower abs": "core", "transverse abdominis": "core",
    "balance stabilizers": "core",
    "obliques": "obliques",
    "glutes": "glutes", "glute medius": "glutes", "glute med-min": "glutes",
    "tensor fasciae latae": "glutes", "hips": "glutes",
    "quads": "quads", "legs": "quads",
    "hamstrings": "hamstrings",
    "adductors": "adductors",
    "calves": "calves", "gastrocnemius": "calves", "soleus": "calves",
    "tibialis anterior": "calves",
    "hip flexors": "hip-flexors",
}

EQUIPMENT_MAP = {
    "barbell": "barbell", "dumbbell": "dumbbell", "machine": "machine",
    "cable": "cable", "bodyweight": "bodyweight", "kettlebell": "kettlebell",
    "band": "band", "weight plate": "plate", "stability ball": "ball",
}

def slug(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s

def split_list(cell):
    cell = re.sub(r"\[[^\]]*\]", "", cell)          # drop "[ambiguous]" style notes
    # labels that legitimately contain a slash must survive the split below
    cell = re.sub(r"glute\s*med\s*/\s*min", "glute med-min", cell, flags=re.I)
    parts = re.split(r",|/|;", cell)
    return [p.strip() for p in parts if p.strip() and p.strip() != "—"]

def to_keys(cell, unknown):
    keys = []
    for label in split_list(cell):
        k = MUSCLE_MAP.get(label.lower())
        if k is None:
            unknown.add(label)
        elif k not in keys:
            keys.append(k)
    return keys

def main():
    if not SRC.exists():
        sys.exit(f"missing source: {SRC}")
    rows, unknown = [], set()
    for line in SRC.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        c = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(c) != 7 or c[0] == "Exercise Name" or set(c[0]) <= set("-"):
            continue
        name = re.sub(r"\s*\[[^\]]*\]", "", c[0]).strip()
        rows.append({
            "id": slug(name),
            "name": name,
            "aliases": split_list(c[5]),
            "equipment": EQUIPMENT_MAP.get(c[3].lower(), slug(c[3])),
            "mechanic": c[4].lower(),
            "difficulty": c[6].lower(),
            "primary": to_keys(c[1], unknown),
            "secondary": to_keys(c[2], unknown),
        })

    # ids must be unique — disambiguate with the equipment if a name repeats
    seen = {}
    for r in rows:
        if r["id"] in seen:
            r["id"] = f'{r["id"]}-{r["equipment"]}'
        seen[r["id"]] = True

    if unknown:
        print("UNMAPPED muscle labels (add them to MUSCLE_MAP):")
        for u in sorted(unknown):
            print("   ", u)

    doc = {"version": 1, "count": len(rows), "muscleKeys": MUSCLE_KEYS, "exercises": rows}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} — {len(rows)} exercises, {OUT.stat().st_size // 1024}KB")
    missing_primary = [r["name"] for r in rows if not r["primary"]]
    if missing_primary:
        print("rows without a primary muscle:", missing_primary)

if __name__ == "__main__":
    main()
