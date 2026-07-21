# Owen Smith — Portfolio

A static portfolio site. The page is **data-driven**: it renders from
`manifest.json`, which is generated from the images in `img/` plus the
metadata in `content.json`. Drop images in, regenerate, and they appear —
no code changes needed.

## Add / change work

You have two ways:

### A) The studio (easiest — add images, edit text, reorder, publish)

```bash
node studio.mjs          # then open http://localhost:8765
```

Click **login** in the footer (your password), then:

- **Drop images or video clips anywhere on the page** (or into the `img/` folder) to add them.
- Click **✎ Edit** on a card to set its **title**, **description**, and **section** (Physical / Digital).
- **Drag** cards to reorder.
- Click **Publish to GitHub** to commit & push.

### B) By hand

1. Drop images into `img/` using the naming convention below.
2. Run `node generate.mjs` to rebuild `manifest.json`.
3. Commit and push.

## Naming convention

`<Project Words>[-N].<ext>` — files sharing a prefix become one project,
ordered by the trailing number:

```
Cutting-Board-1.jpeg   ┐
Cutting-Board-2.jpeg   ┘→  "Cutting Board" (2-photo carousel)
Balance-Scale.jpeg     →   "Balance Scale" (single)
```

- Images (`.jpeg/.jpg/.png/.webp`) and clips are supported. Any clip or animation —
  `.mov`, `.mp4`, `.gif`, `.webm`, `.avi`, and more — is auto-converted to a muted,
  seamlessly-looping `.mp4` (plays like a GIF, a fraction of the size). Full-res
  originals are kept in `img/_originals/` (git-ignored).
- Cards with multiple items auto-rotate every 5s and show arrows + dots.
- Large photos are auto-optimized for the web; the full-resolution originals are
  kept in `img/_originals/` (git-ignored, never deployed).

## Files

| File | Purpose |
|------|---------|
| `index.html` | The site (renders from `manifest.json`). |
| `manifest.json` | Generated — what the site reads. **Do not edit by hand.** |
| `content.json` | Your titles, descriptions, sections, and order. |
| `generate.mjs` | Scans `img/`, optimizes, writes `manifest.json`. |
| `studio.mjs` | Local authoring server (add/edit/reorder/publish). |

## Deploy

It's fully static — any static host works. For GitHub Pages, serve from the
`main` branch root. The studio/generator are local tools and aren't needed at runtime.
