# barotrauma-sub-preview

CLI tool to **swap or composite preview images** in Barotrauma `.sub` files.

Use cases:

- Copy a **vanilla sub preview** (e.g. original Kastrull thumbnail) onto your edited sub
- Embed a **custom PNG/JPG/WebP**
- **Composite linked shuttles** onto the preview (the Sub Editor “Create” button skips them)

Works on **Windows, Linux, and macOS** with [Node.js](https://nodejs.org) 18+.

## Quick start

```bash
git clone https://github.com/RaySc1/barotrauma-sub-preview.git
cd barotrauma-sub-preview
npm install
node set-sub-preview.mjs path/to/YourSub.sub
```

Interactive menu:

1. Vanilla submarine (from `Content/Submarines`)
2. Another `.sub` file
3. Custom image (PNG/JPG/WebP)
4. Export current preview as PNG
5. Composite linked shuttle(s)

A backup is created automatically: `YourSub.sub.bak-preview-…`

## Requirements

- **Node.js** 18+
- **Barotrauma** (Steam) — vanilla subs are read from `Content/Submarines`
- **`npm install`** — only needed for shuttle compositing (`pngjs`)

If auto-detection fails, set your install path (adjust if Steam is on another drive):

```bash
# Windows (PowerShell) — default Steam location
$env:BAROTRAUMA_DIR = "C:\Program Files (x86)\Steam\steamapps\common\Barotrauma"

# Linux / macOS
export BAROTRAUMA_DIR="$HOME/.steam/steam/steamapps/common/Barotrauma"
```

## CLI examples

```bash
# List vanilla subs with previews
node set-sub-preview.mjs --list-vanilla

# Copy vanilla Kastrull preview
node set-sub-preview.mjs --to MySub.sub --from-vanilla Kastrull

# Copy preview from another sub
node set-sub-preview.mjs --to MySub.sub --from-sub Other.sub

# Use a custom image
node set-sub-preview.mjs --to MySub.sub --from-png screenshot.png

# Export embedded preview
node set-sub-preview.mjs --to MySub.sub --export-png out.png

# Composite linked shuttle(s)
node set-sub-preview.mjs --to MySub.sub --composite-shuttle
```

## Linked shuttle previews (custom subs)

The Sub Editor **“Create”** button renders **only the main sub** — linked shuttles are omitted (same for `wikiimage_sub`). Vanilla subs look fine because their preview was baked in manually.

### Option A — vanilla preview (similar layout)

If your sub still matches a vanilla hull:

```bash
node set-sub-preview.mjs --to MySub.sub --from-vanilla Kastrull
```

Copies the full vanilla preview **including shuttle**. Not suitable for heavily modified hulls.

### Option B — composite shuttle (recommended for custom subs)

1. **Main sub:** Sub Editor → Save → Preview **Create** (shuttle missing — expected)
2. **Shuttle `.sub`:** open separately → Save → **Create** (shuttle needs its own preview)
3. Main `.sub` must contain `<LinkedSubmarine … pos="…" filepath="…">` (normal after linking in editor)
4. Run:

```bash
node set-sub-preview.mjs --to MySub.sub --composite-shuttle
```

Shuttle file lookup order: `filepath` from XML → `ShuttleName.sub` next to main sub → vanilla `Content/Submarines/`.

**Accuracy:** placement uses `pos` + `dimensions` — usually close; exotic docking angles may need a manual screenshot + `--from-png`.

## FAQ

**Does this change wiring, inventory, or parts?**  
No — only the `previewimage` attribute on `<Submarine>`.

**Must the image be PNG?**  
For `--from-png`, PNG/JPG/WebP work. The tool embeds base64 PNG as Barotrauma does. Keep under ~1 MB for Workshop uploads.

**Why not use Sub Editor “Create”?**  
That renders a **new** image without the shuttle. This tool copies vanilla previews or composites shuttles by position.

**Campaign saves (`.save`)?**  
The sub lives **inside** the save archive. Unpack → edit `Kastrull.sub` (etc.) → repack → upload. Do not leave `.bak` files in the unpacked folder.

## CLI reference

| Flag | Effect |
|------|--------|
| `node set-sub-preview.mjs` | Interactive (asks for target path) |
| `node set-sub-preview.mjs target.sub` | Interactive with target |
| `--list-vanilla` | List vanilla subs |
| `--to sub --from-vanilla Name` | Copy vanilla preview |
| `--to sub --from-sub other.sub` | Copy from another sub |
| `--to sub --from-png file` | Custom image |
| `--to sub --export-png file` | Export preview |
| `--to sub --composite-shuttle` | Add linked shuttle preview(s) |
| `--barotrauma-dir path` | Manual install path |
| `--no-backup` | Skip backup (not recommended) |

## License

MIT — see [LICENSE](LICENSE).  
Author: **RaySc1 (Draco)** — https://github.com/RaySc1

Not affiliated with FakeFish Games / Barotrauma.
