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

Azure TTS, card practice, vocabulary collection, and audio cache management are
planned for later phases.

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