# ETERNAL VOID — After Effects template build

Builds `ETERNAL-VOID.aep` and `ETERNAL-VOID-Final.mp4` from the template in
`C:\Eternalvoidco\Eternalvoidco\assets\After Effects Assets` on the Windows machine
that has After Effects installed.

| File | Purpose |
|---|---|
| `Run-EternalVoid.ps1` | Full pipeline: inventory → AE customise → aerender → H.264 encode → verification |
| `ev_customise.jsx` | Runs inside After Effects: opens the `.aet`, swaps logo, replaces text, checks dependencies, saves `.aep`, queues render |
| `Run-EternalVoid.bat` | Double-click launcher for the PowerShell script |

## Prerequisites

- After Effects (any version that opens the template; native H.264 output needs AE 2023+ if ffmpeg is absent).
- Recommended: ffmpeg 5.1+ on `PATH` (`winget install Gyan.FFmpeg`) for the CRF 14 H.264 encode.
- Any fonts or plugins the template lists in its instructions must be installed first.
- Close After Effects before running.

## Steps

1. Copy this folder anywhere on the Windows PC (e.g. `C:\Eternalvoidco\Eternalvoidco\tools\after-effects`).
2. Inspect only (changes nothing, writes `ETERNAL VOID Output\ev-customise-log.txt`):

   ```bash
   powershell -ExecutionPolicy Bypass -File .\Run-EternalVoid.ps1 -InspectOnly -EnableScriptFileAccess
   ```

3. Read the log. If it lists several emblem files, several templates, several top-level comps, or no logo placeholder, re-run with the matching parameter:
   - `-Logo "C:\...\<original EV emblem>.png"` — the clean transparent original
   - `-Template "C:\...\<template>.aet"`
   - `-RenderComp "<exact comp name>"`
   - `-LogoTarget "<exact placeholder item name>"`
4. Build:

   ```bash
   powershell -ExecutionPolicy Bypass -File .\Run-EternalVoid.ps1 -Logo "C:\path\to\EV emblem.png"
   ```

   Add `-LogoColor White` if the emblem must appear white (Fill effect, alpha preserved).
   Add `-HideOtherPlaceholders` only if the template has slogan/tagline placeholders you want hidden instead of filled.
5. Open `ETERNAL VOID Output\verify-frames\contact-sheet.png` and the individual frames; confirm the emblem, `eternalvoid.co` and `ETERNAL VOID`.

## What the script does / does not do

- Opens the `.aet` as a new project; the template and source images are only read (SHA-256 checked afterwards).
- Logo: if the placeholder is a still footage item, it is swapped with **Replace Footage**, so every nested comp, keyframe, effect and camera move is untouched; scale/anchor are multiplied by one uniform factor so the emblem fits the placeholder box without stretching or cropping. If the placeholder is a logo comp, the emblem is added inside that comp, fitted to the placeholder bounds, and the placeholder layers are disabled (not deleted).
- Text: website placeholders → `eternalvoid.co` (All Caps turned off for that layer so it stays lowercase); brand/company placeholders → `ETERNAL VOID`. Styles, keyframes and animators are kept; font size is reduced only if the new text would overflow/wrap. Essential Graphics text overrides are handled too.
- Stops (status `BLOCKED`) without rendering if footage, fonts or plugins are missing, or if unknown placeholder text (e.g. a slogan) remains. Nothing is substituted silently.
- Renders full comp length at native resolution and frame rate via `aerender` (Lossless intermediate), then encodes H.264 High, CRF 14, yuv420p, BT.709, AAC 320 kbps (if the template has audio), `+faststart`.

## Output (`ETERNAL VOID Output\`)

- `ETERNAL-VOID.aep`, `ETERNAL-VOID-Final.mp4`, `ETERNAL-VOID-intermediate.mov`
- `ev-customise-log.txt`, `ev-manifest.txt`, `aerender-log.txt`, `ffmpeg-log.txt`, `asset-inventory.txt`, `VERIFY-REPORT.txt`
- `verify-frames\` (opening, 25/50/75/90 %, ending, contact sheet)
- `scripts\` (copies of these scripts)
