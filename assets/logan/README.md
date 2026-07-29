# Logan — mascot assets

`src/` holds the masters: cleaned (ghost RGB removed, faint alpha noise dropped), trimmed to
content, palette-quantised. Raw 1024x1024 ChatGPT exports (~1.8MB each) are NOT committed —
they live outside the repo; these masters are the working source of truth.

`../../public/img/` holds the served set, generated from `src/` by `tools/build-sprites.py`:

| asset | served size | used for |
|---|---|---|
| logan-rest, logan-go | 384px | rest timer (counting / finished) |
| logan-pr | 320px | personal-record toast |
| logan-celebrate | 448px | day or week completed |
| logan-plan, logan-thinking | 384px | empty state / admin parsing |
| head-ready, head-tired, head-pumped, head-focused | 128px | day header expression (~30px on screen) |
| logan-mark, logan-mark-maskable | 192 / 384px | brand badge |
| icon-192, icon-512, icon-maskable-512, apple-touch-icon | PWA | home-screen icon (Logan's head) |
| favicon-32, favicon-64 | browser tab | pine badge |

Regenerate after changing a master:

    python3 tools/build-sprites.py
