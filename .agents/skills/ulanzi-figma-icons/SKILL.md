---
name: ulanzi-figma-icons
description: Create or edit Ulanzi icons in Figma with consistent styling, 32x32 slots, and 24x24 main-icon frames, allowing corner addons beyond the main frame. Use for Ulanzi icon requests, including follow-up icon additions on the dedicated Ulanzi Figma page; do not impose these project conventions on unrelated Figma files.
---

# Ulanzi icons in Figma

## Dedicated destination

The user maintains this page specifically for creating Ulanzi icons:
[Ulanzi icon page](https://www.figma.com/design/YbUNFaHctftbf0ji4w5b5I/Ulanzi?node-id=677-82).

- File key: `YbUNFaHctftbf0ji4w5b5I`.
- Page ID: `677:82`.
- Existing `Default` icon grid: `678:77`.

Use this destination for Ulanzi icon requests unless the user specifies another destination. Inspect the current page and grid before editing; IDs and layout may change. Use the available `figma-use` skill for Figma API operations.

If `use_figma` fails with `Can't call "<method>" in read-only mode`, the account lacks edit rights on the file rather than the file being in Dev Mode. Check seats with `whoami`: a View seat cannot be fixed by toggling Design mode, and it also covers that team's Drafts. There is no duplicate-file API — `create_new_file` only creates a blank file — so ask the user to duplicate the file in the Figma UI (right-click the file then **Duplicate**, or **File > Save to your drafts**) and hand back the new URL. A duplicate preserves node IDs, so the page and grid IDs above still resolve; update this section with the new file key when the destination moves.

## Style consistency is essential

Treat the existing icons as the visual reference. Inspect nearby icons and reuse matching shapes, instances, colors, and conventions before drawing new artwork. A new icon must look like part of the same set at its actual display size.

Match silhouette, stroke weight, filled versus outlined treatment, corner shape, visual weight, optical size, and alignment. Keep symbols simple and readable at 24x24. Avoid introducing a different illustration style, arbitrary colors, gradients, shadows, or decorative detail unless requested or established in the relevant reference icons.

Observed palette: light gray `#CDCDCD`, purple accent `#9974F8`, dark detail `#333333`, and a black preview background. Verify the current neighboring artwork and any bound styles or variables before using these values. Prefer existing bindings when available. Use purple sparingly for the action or status accent; preserve established brand colors for branded icons.

For folder icons, reuse the existing folder silhouette and place a compact semantic symbol on it. For related actions, reuse the same base geometry so they read as a family. Rebuilding a silhouette from another icon's `vectorPaths` reproduces it exactly and, unlike cloning, works across files.

Corner accents must be compact solid shapes, such as the sparkle on `ai-usage-stats-folder` or the triangle on `macro-play`. A stroked path with several direction changes packed into roughly 10 px collapses into a colored smudge at 32x32, however clean it looks zoomed in. Simple wide arcs, as on `voice-input`, are the exception that survives.

## Required dimensions and padding

Keep every icon in a **32x32 outer slot**. Choose its internal structure by icon type:

- **Standalone icons:** center the artwork in a **24x24 inner frame at x=4, y=4**, leaving 4 px outer padding. Keep its artwork and strokes inside the inner frame.
- **Folder icons also use a centered 24x24 inner frame at x=4, y=4**. Keep the folder artwork and its semantic details in that frame, following existing folder silhouettes, scale, and alignment. Apply the addon rule below when a folder has a separate corner addon.
- **Icons with addons, such as macro-play:** put only the **main icon** in the centered 24x24 frame. Place the corner addon and any backing shape as separate overlay siblings in the 32x32 slot. **The addon may extend beyond the 24x24 main frame**; keep it within the outer slot and optically aligned with the main icon. Do not shrink the whole composition to fit the main frame or clip the addon at that frame's edge.

For ordinary icons, use a transparent fixed 32x32 auto-layout slot with 4 px padding and a fixed 24x24 inner frame. Addons can use absolute positioning within that slot. Folder slots use the same centered 24x24 inner frame as other icons. Name the outer slot for the action, the main frame `icon`, and addons descriptively, such as `play-addon`.

Size and align the artwork after adding its frame. Compare its optical size with neighboring icons; do not retain unnecessary padding from a 32x32 SVG viewBox when fitting the main artwork into 24x24. Preserve proportions, stroke weight, and visual consistency.

## Export settings

Add a PNG export preset to every created or edited icon's **outer 32x32 slot**, so the export includes its padding and corner addons. Set the export width to **196 px (196w)**. In the Figma Plugin API, use `{ format: 'PNG', constraint: { type: 'WIDTH', value: 196 }, suffix: '' }` in the slot's `exportSettings` array. Preserve unrelated existing export presets and avoid duplicating this preset. Verify the PNG format and WIDTH 196 constraint before reporting completion. Adding the preset does not require exporting or downloading a file unless requested.

## Placement and verification

Append to the next available grid slot, preserving existing order and spacing. The observed grid has five columns and 12 px gaps, with wrapping enabled; inspect its live settings rather than rebuilding it. Allow the grid to grow for a new row.

After editing, verify the 32x32 slot and the applicable structure: standalone artwork stays in its centered 24x24 frame; folders also have a centered 24x24 frame; addons may cross the main frame edge without clipping while staying within the outer slot. Render the affected grid **at actual size** and compare the result with neighboring icons for consistent size, visual weight, color, and spacing. A zoomed render hides the legibility failures that matter, so judge every icon at 1x; upscale that 1x render with nearest-neighbour sampling to inspect it without inventing detail. When a symbol's readability is uncertain, build the candidates as a temporary off-grid strip, compare them at 1x, then apply the winner and delete the strip. Correct discrepancies before reporting completion. Keep artwork editable and return a direct Figma link to the result.
