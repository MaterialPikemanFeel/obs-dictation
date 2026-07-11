# Kakitori

Kakitori is an Obsidian plugin for focused Japanese dictation practice. It keeps
its imported materials separate from ordinary notes and stores its data under
`_Kakitori` in the active vault.

## Phase 1

- Dedicated Kakitori app tab
- Paste, `.txt`, and `.md` material import
- Japanese sentence segmentation preview
- Material library and article home
- Standard 20×20 genkō yōshi
- Vertical and horizontal writing
- Automatic 400-character pagination
- Opaque sentence masks
- Contextual vertical or horizontal controls
- Reveal, reconceal, difficult-sentence flags, and notes
- Data stored in `_Kakitori/Materials` and `_Kakitori/Notebooks`

## Phase 2

- Card practice with manual reveal and reconceal
- Full-order, difficult-sentence, and random decks
- Independent card progress and restart
- Vertical or horizontal answers following the article direction
- Shared sentence difficulty flags and notes
- Azure Speech playback with live ja-JP voice discovery
- Per-sentence MP3 caching under `_Kakitori/Cache`

Vocabulary collection and audio cache limits/cleanup remain planned for later
phases.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to:

```text
<vault>/.obsidian/plugins/kakitori/
```