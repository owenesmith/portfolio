# Photos

Drop your project photos in this folder. They're wired up from the `projects`
list near the bottom of `index.html`.

## How it maps

Each project has a `photos` array of paths relative to the site root:

    {
      title: "Striped Cutting Board",
      desc:  "Maple, purpleheart, padauk, and walnut.",
      photos: ["img/cutting-board-1.jpg", "img/cutting-board-2.jpg"]
    }

- One photo   → `photos: ["img/your-file.jpg"]`            (no carousel)
- Many photos → `photos: ["img/a.jpg", "img/b.jpg", ...]`  (arrows + dots appear)

## Tips

- Any web format works: `.jpg`, `.png`, `.webp`.
- Frames are portrait (4:5) and crop-to-fill (`object-fit: cover`), so portrait
  shots look best — but any size/orientation is fine.
- The current `cutting-board-*`, `wenge`, and `coasters-*` files are TEST
  IMAGES. Delete them once your real photos are in.
