# Token Label Styler (Owlbear Rodeo extension)

Restyle the **native** name labels of every token in the current Owlbear Rodeo
scene with one click: font family, size, weight, colour, opacity, alignment,
and the spacing that controls how large the label background is.

Changes are written to the shared scene items through the official SDK, so
every player in the room sees them and they persist with the scene.

## Features

- **Token Label Styler** action in the room's extension bar. Clicking it opens a compact settings popover.
- Defaults: **Serif, size 18, white, centred**, plus tight spacing (padding 2, line height 1.1).
- Live preview (approximate, clearly marked) that never touches the scene.
- **Apply to All Tokens** restyles every label on the chosen layers (Characters and Mounts by default, Props optional). It:
  - changes only label style fields; label text and all other token data are left as they are;
  - never creates items, so labels can't be duplicated;
  - skips tokens that already have the style, so it sends no unnecessary updates;
  - works in batches, with progress shown, so large scenes don't freeze the UI;
  - reads the scene back afterwards and lists any token that didn't actually change.
- **Reset Settings to Defaults** restores the form only. The scene changes only when you click Apply.
- Your settings are saved in the browser and come back when you reopen the extension.
- The panel shows whether your current settings match the style last applied to the scene.

## Running locally

Requires Node.js 18+.

```bash
npm install
npm run dev        # serves http://localhost:5173 with CORS for owlbear.rodeo
```

Then in Owlbear Rodeo:

1. Open your **Profile** page, click **Add Extension**, and enter
   `http://localhost:5173/manifest.json`.
2. Create or open a room and enable **Token Label Styler** in the room's
   extension settings.
3. The extension's icon appears in the top-left extension bar. Click it to open the panel.

Other scripts:

```bash
npm test           # unit tests (vitest): planning, batching, text preservation, failure reporting, settings
npm run typecheck
npm run build      # production build into dist/
```

### Manual test checklist

1. Add a few tokens. Name some (e.g. "Goblin Warrior"), leave one unnamed, and
   add a token whose text is set to "Text" mode rather than a label.
2. Open the panel, change settings and watch the preview. The scene must not change.
3. Click **Apply to All Tokens**. The labels change, and the names stay the same.
4. Open the room in a second browser or as a second player. They see the same styling.
5. Click Apply again. It reports that every token already has this style, and sends no updates.
6. Close and reopen the panel. Your settings are still there.
7. Click **Reset Settings to Defaults**. Only the form changes, until you apply.
8. As a player without edit permission, click Apply. The tokens that weren't updated are listed.

## Installing / publishing

The extension is a static site. Build it and host `dist/` on any HTTPS host
that serves the files with CORS allowing `https://www.owlbear.rodeo`
(GitHub Pages, Netlify, Vercel, Cloudflare Pages, and so on).

```bash
npm run build
# upload dist/ (contains index.html, manifest.json, icon.svg, assets/)
```

### Cloudflare Pages

`public/_headers` (copied into `dist/`) adds the CORS header Cloudflare Pages
needs. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages →
Connect to Git**, pick this repository, and use:

- Framework preset: **None** (or Vite)
- Build command: `npm run build`
- Build output directory: `dist`

Alternatively, deploy from your machine with
`npm run build && npx wrangler pages deploy dist --project-name token-label-styler`.

### Cloudflare Workers (static assets)

If the dashboard puts you in the Workers flow instead of Pages,
`wrangler.jsonc` configures a static-assets Worker that serves `dist/`
(the `_headers` file applies there too). Use the Worker name
`token-label-styler`, build command `npm run build`, and deploy command
`npx wrangler deploy`. Or from your machine: `npm run build && npx wrangler deploy`.

Users install it by adding `https://<your-host>/manifest.json` from their
Owlbear Rodeo profile. To list it in the public Owlbear Rodeo extension
store, follow Owlbear Rodeo's submission process in their extensions documentation.

## How it works

### SDK findings (`@owlbear-rodeo/sdk` 3.1.0, the latest release)

These were checked against the SDK's published type definitions and builder
source. The docs website (docs.owlbear.rodeo) refused automated access from
the build environment, so the type definitions are the reference used here.

| Question | Finding |
| --- | --- |
| How are token labels represented? | A token is an `IMAGE` item. Its name label is the item's own `text: TextContent` field, shown as a label when `textItemType === "LABEL"` (the default). The label is **not** a separate scene item. The standalone `LABEL` item type is something else (a free-floating label with a pointer). |
| How are tokens retrieved? | `OBR.scene.items.getItems()`, filtered to `type === "IMAGE"` on the chosen layers (`CHARACTER`, `MOUNT`, `PROP`). |
| Can labels be modified in place? | Yes. `OBR.scene.items.updateItems(ids, drafts => …)` gives immer drafts, and we set fields on `draft.text.style`. |
| Font family / size / colour / alignment? | Yes. They are `TextStyle.fontFamily`, `fontSize`, `fillColor`, and `textAlign` (`LEFT`/`CENTER`/`RIGHT`). `fontWeight`, `fillOpacity` and `lineHeight` are also exposed. |
| Background padding / dimensions? | Partly. `TextStyle.padding` is a single number (the SDK default for image labels is 8). There are no separate horizontal and vertical values, and no explicit width or height for the background. `lineHeight` (default 1.5) also adds vertical space. Lowering both is the supported way to shrink the background. |
| Background colour / opacity / corner radius? | **Not available for token labels.** These (`backgroundColor`, `backgroundOpacity`, `cornerRadius`) exist only on the standalone `LABEL` item's `LabelStyle`. |
| Persistence and sync | `updateItems` computes immer patches and sends only the changed top-level fields (here `text`) to Owlbear Rodeo. Owlbear Rodeo saves them with the scene and syncs them to every connected player. |
| Avoiding duplicates | Nothing is ever added, because labels are fields on the token itself. |
| Tokens without labels | A token can have an empty label. Owlbear Rodeo just doesn't draw it. The style is still applied, so the label appears styled as soon as someone names the token. No text is invented. |
| Roles and permissions | GMs can update any item. A player's ability to edit characters, mounts and props depends on the room's permission settings (`CHARACTER_UPDATE`, `CHARACTER_OWNER_ONLY`, …). Instead of guessing, the extension attempts the update, reads the items back, and reports every token that didn't change. |
| Hidden / locked tokens | `visible` and `locked` are ordinary item fields. The SDK types document no restriction on updating such items, so hidden and locked tokens are included, and their `visible`/`locked` flags are kept. If Owlbear Rodeo refuses one, the read-back step reports it. |

### Scene-wide update flow (`src/labels.ts`)

1. Read all scene items. Keep `IMAGE` items on the selected layers.
2. Sort them:
   - **needs update**;
   - **already styled** (exact match on every styled field, so no update is sent);
   - **text overlay** (`textItemType: "TEXT"`): skipped and reported, because it isn't a label;
   - **invalid** (no text data): reported as a failure.
3. Send the tokens that need updating in batches of 50 with
   `updateItems(ids, …)`. Passing ids rather than item objects makes the SDK
   re-read each item just before changing it, so the label text written back
   is the latest text, never a stale copy. The update function writes only
   `fontFamily`, `fontSize`, `fontWeight`, `fillColor`, `fillOpacity`,
   `textAlign`, `padding` and `lineHeight`. Stroke, vertical alignment, text
   content, size mode, metadata, position, and everything else are left as they are.
4. If a batch throws, its tokens are retried one at a time, so a single bad
   token doesn't fail the rest. Its error message is kept for the report.
5. Read the updated items back and count a token as updated only if its style
   now matches. Anything else is listed with a reason.
6. Write a small record of the applied style into the scene metadata
   (`com.groudonmcl.token-label-styler/applied`). The panel uses it to show
   whether your settings differ from the scene. It's informational only.
7. Show the result in the panel and as an Owlbear Rodeo notification.

### Settings persistence (`src/settings.ts`)

Preferences live in the browser's `localStorage`, under a namespaced key.
They are validated on load, and corrupt values fall back to the defaults. They
only fill in the form. Storage is never used to style labels: the scene is
changed only through `updateItems`. If storage is blocked (e.g. a privacy
mode), the extension still works with defaults for that session.

### Code layout

| File | Responsibility |
| --- | --- |
| `public/manifest.json`, `public/icon.svg` | Extension registration and the action (menu) entry |
| `index.html`, `src/style.css` | Popover markup and theme-aware styling |
| `src/main.ts` | Connects the SDK (`OBR.onReady`, theme, scene readiness, notifications) to the UI, and handles errors |
| `src/ui.ts` | Settings form, live preview, result reporting |
| `src/settings.ts` | Settings model, defaults, validation, persistence |
| `src/labels.ts` | Token discovery, change planning, batched updates, verification |
| `src/sceneRecord.ts` | Shared record of the last applied style |

## Limitations and requirements not met exactly

1. **Background colour, background opacity and corner radius are not
   adjustable.** Owlbear Rodeo draws the token label background itself, and
   the SDK exposes no fields for it on image items. The only alternative is a
   custom rendering: attach a separate `LABEL` item (which does have these
   properties) to each token. That was assessed and rejected:
   - the native label can't be hidden without erasing its text, so tokens would show two labels;
   - the custom labels would be separate items that can drift from the token's real name;
   - they would add scene items, which breaks the "no duplicates" and "styling tool, not label editor" requirements.

   The UI explains this briefly under *Background spacing*.
2. **Horizontal and vertical padding can't be set separately.** `padding` is one
   value for all sides. `lineHeight` gives some independent control of vertical spacing.
3. **Label visibility is not offered.** The SDK has no flag that hides a
   token's label separately from the token. The only way would be to clear
   the label text, which would destroy it. Setting text opacity to 0 hides the
   text but leaves the background, so it isn't presented as a visibility toggle.
4. **Font families.** `fontFamily` is a free-form string that Owlbear Rodeo
   passes to the browser's font rendering. The panel offers the generic CSS
   families (`serif`, `sans-serif`, `monospace`, `cursive`) and `Roboto`
   (the SDK default), which every browser can resolve. Exact typefaces depend
   on each viewer's system fonts. This has not been checked inside a live room
   from this environment.
5. **Text alignment** is expected to make a visible difference only on labels
   that wrap onto more than one line. Single-line labels are sized to their text.
6. **Preview is approximate.** It mimics Owlbear Rodeo's label in HTML and
   CSS. The real label scales with the map zoom and grid.
7. **Permission failures are detected after the fact.** The SDK has no
   per-item "can I edit this?" check. Updates are attempted, and any token
   whose style didn't change is reported. If Owlbear Rodeo were to accept a
   change locally and reject it on the server later, the extension couldn't
   tell.
8. **New tokens are not styled automatically.** Tokens added later keep
   Owlbear Rodeo's default style until you click Apply again. This was not
   requested, and doing it would mean editing tokens without being asked.
9. **Documentation access.** The official docs pages returned HTTP 403 to the
   build environment. Every API used was verified against the SDK 3.1.0 type
   definitions and source instead. Please do the manual test checklist above
   in a real room before relying on it.
