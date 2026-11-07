# ORBIT

A fast dual-pane file manager for Windows, built with Electron, Vite, TypeScript and React. Performance first:
virtual lists, streamed folder listing and lazy thumbnails, so a 50,000-file folder stays smooth.
Built by [SAINT SYSTEMS].


## Features

- Dual pane with drag and drop (Ctrl = copy), breadcrumbs, instant filter and recursive search
- Copy, cut, paste, rename, delete to the Recycle Bin, undo (Ctrl+Z), one operation queue with progress and Cancel
- ZIP: compress any selection, extract to a folder or here (never overwrites, refuses unsafe archives)
- Quick Look (Space), thumbnails for images, video and PDF, built-in PDF reader (search, zoom, selectable text)
- Recycle Bin view that shows what Windows holds: restore, delete permanently, empty
- System Monitor: CPU, per-core load, clock, temperature (when the PC exposes it), GPU, memory, disk, network
- Copilot sidebar (Groq): understands the folder you are in, reads files and PDFs, and proposes changes as a plan
  card; nothing happens until you click Apply
- Home page, light/dark theme, accent colours, Details / Compact / Icons layouts, right-click menus, command bar
- Installer with the ORBIT logo icon

## Quick start (development)

Requires Node 22+ and npm. Windows 10/11 for the full feature set.

```bash
git clone <your repo url>
cd orbit
npm install        # also downloads Electron and esbuild (scripts/postinstall.mjs)
npm run dev        # or F5 in VS Code -> "ORBIT: Dev (electron-vite)"
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Run with hot reload |
| `npm test` | Unit tests (Node's built-in runner) |
| `npm run typecheck` | TypeScript strict check |
| `npm run build` | Build to `out/` |
| `npm run dist` | Build the Windows installer to `dist/` |
| `npm run dist:portable` | Build a single-file portable `.exe` |
| `npm run postinstall` | Re-run the Electron/esbuild setup if you ever see "Electron uninstall" |

## User guide

**Getting around.** The sidebar holds Home, quick-access folders, your drives (with free space), the Recycle Bin,
System Monitor and Copilot. The path bar is clickable breadcrumbs. Backspace goes up, Enter opens. The toggle in the
title bar switches dual pane on and off; Tab switches pane; F6 / Shift+F5 move / copy to the other pane.

**Selecting and changing files.** Click, Shift+click, Ctrl+click or the keyboard (Shift+arrows). Ctrl+C / X / V,
F2 to rename, Delete sends to the Recycle Bin, Ctrl+Z undoes rename, move, copy, create, zip and extract. Dragging
moves; hold Ctrl to copy. Existing files are never overwritten: you get `name (1)`.

**Searching.** Ctrl+F. Typing filters the current folder instantly; Enter searches all subfolders. "Stop search"
in the status bar cancels it.

**ZIP.** Right-click a selection, "Compress to ZIP". Right-click a `.zip`, "Extract to folder" or "Extract here".
Progress shows in the status bar with Cancel. Password-protected ZIPs are not supported yet.

**PDFs.** Enter opens the built-in reader (Ctrl+F search, +/- zoom, PgUp/PgDn). Right-click for "Open with default app".

**Copilot.** Open it from the sidebar or Ctrl+J, paste a free Groq API key from console.groq.com when asked. It
is stored encrypted on your PC and never leaves the main process. Ask things like "sort the PDFs in this folder
into folders by year". It reads, then shows a plan card; review it and press Apply. It cannot delete permanently.

**System Monitor.** Live while the page is open. Anything your PC does not provide shows N/A with the reason (CPU
temperature often needs an ACPI zone or administrator rights; fans, voltage and power need a hardware driver, so
they are not shown).

**Installing.** `npm run dist`, run `dist\ORBIT-Setup-0.1.0.exe`, then start ORBIT from the Start menu. The
installed app has its own settings, separate from `npm run dev`. The installer is unsigned: SmartScreen says
"More info" then "Run anyway".

## Spec sheet

| Area | Detail |
| --- | --- |
| Platform | Windows 10/11 x64 (developed and unit-tested on Linux) |
| Runtime | Electron 33, Node 22 tooling |
| Language | TypeScript (strict), React 18 |
| Build | electron-vite 2 / Vite 5; installer by electron-builder 26 (NSIS, per-user, non-one-click) |
| Runtime dependency | `pdfjs-dist` 4.10.38 only; everything else is bundled at build time |
| ZIP | `yazl` 3.3.1 (write), `yauzl` 3.4.0 (read); stored vs deflate by file type; 500,000 entries and 200 GiB extraction caps |
| AI | Groq API, tool calling; model chosen from the live model list (gpt-oss, qwen, llama families preferred); max 6 steps and 12 tool calls per question; 4000 output tokens |
| Performance budget | Cold start under 1 s, folder open under 100 ms, 60 fps scrolling, tested on 50,000 files |
| Listing | `opendir` streamed in 200-entry chunks; virtualised rows (`@tanstack/react-virtual`) |
| Thumbnails | OS shell thumbnails, 3 at a time, de-duplicated, disk cache pruned to 200 MB |
| PDF | Loaded on first use; files up to 300 MB; pages drawn only when on screen |
| Operations | One FIFO queue: copy, move, rename, trash, mkdir, newfile, zip, unzip; progress, cancel, undo |
| Delete | OS Recycle Bin via `shell.trashItem`; no permanent delete from the file list or Copilot |
| Security | Context isolation and sandbox on, `webSecurity` on, renderer has no Node access, typed IPC only; Groq key encrypted with Electron `safeStorage`; secret-file denylist (`.env`, `.ssh`, `*.pem`...) hidden from the model; every AI plan re-validated on disk |
| Tests | 188 unit tests (Node test runner) plus Chromium checks against the built renderer |
| Source size | about 11,600 lines of TypeScript / TSX |
| Install size | about 370 MB unpacked (Electron) |
| Licence | not yet chosen |

## Architecture

- `src/shared/types.ts` is the single source of truth for IPC channels and types
- `src/main` is the Electron main process: `index.ts` (window and IPC), `ops/` (listing, queue, zip, search, thumbnails,
  Recycle Bin, drives, system sensors), `ai/` (Groq client, key store, agent loop, tools, plan validation)
- `src/preload/index.ts` is the typed `window.orbit` bridge
- `src/renderer` is the React UI: panes, menus, Quick Look, PDF reader, Copilot panel, monitor, Recycle Bin
- `scripts/postinstall.mjs` fetches Electron and esbuild binaries; `resources/` holds the logo and icons

Design rules: the renderer never touches Node or `ipcRenderer`; delete uses the OS Recycle Bin; undo covers
rename, move, copy, create, zip and extract; nothing overwrites and nothing deletes what it did not create.

## Known unverified

Tested on Linux and in Chromium, not yet on real Windows or inside real Electron: the installer build, pdf.js worker
loading, the real Groq API with the chosen model, thumbnails, video and PDF behaviour, the Recycle Bin view, ZIP on
real files. Details and history of every bug: [docs/LESSONS.md](docs/LESSONS.md).

## Major errors we hit (and fixed)

Full list of every bug: [docs/LESSONS.md](docs/LESSONS.md). These three mattered most.

**1. Recycle Bin did not show what Windows holds.** The old build kept its own bin, and the first rebuilt view
showed nothing for files deleted in Windows. Fix: delete uses the real OS Recycle Bin (`shell.trashItem`), and the
view now reads the bin straight from disk (`$Recycle.Bin\<your SID>`: the `$I` record for name, original path
and date, the `$R` file for the data). No PowerShell, no separate bin to keep in sync. Restore never overwrites and
destructive actions ask first. Still needs confirming against a real Windows bin.

**2. CPU temperature shows N/A.** Windows does not give apps a simple CPU temperature. ORBIT tries the performance
counters, then falls back to the ACPI thermal zone. On the dev PC neither is exposed, so the tile says
"N/A" with the reason instead of a made-up number. Other PCs may work. Fan speed, voltage, current and power need a
hardware driver, so they are not shown.

**3. npm blocked install scripts: `Error: Electron uninstall`.** npm skipped the install scripts for `electron` and
`esbuild`, so their binaries were never downloaded and `npm run dev` failed. Manual workaround:
`node node_modules\electron\install.js` and `node node_modules\esbuild\install.js`. Permanent fix:
`scripts/postinstall.mjs` runs both after `npm install`, and `npm run postinstall` repeats it. The installed app
(`npm run dist`) removes the need for `npm run dev` entirely.

## Keys

| Key | Action |
| --- | --- |
| Arrows / PageUp / PageDown / Home / End | Move (Shift extends the selection) |
| Enter, Backspace | Open folder or file (PDFs open in ORBIT, others in the default app), go up |
| In the Recycle Bin: Enter / Delete / Ctrl+A | Restore / delete permanently (asks first) / select all |
| In the PDF reader: Esc / PgUp PgDn / Home End / + - 0 / Ctrl+F, F3 | Close / scroll / first-last page / zoom, fit / search, next match |
| Ctrl+J | Show / hide the Copilot panel |
| Space | Quick Look (arrows keep working while it is open; Esc or Space closes) |
| Tab | Switch pane (dual pane) |
| F6 / Shift+F5 | Move / copy the selection to the other pane |
| Drag | Move to a folder or pane. Hold Ctrl to copy |
| Ctrl+C / X / V, Delete, F2, Ctrl+Z | Copy / cut / paste, trash, rename, undo |
| Right-click, Shift+F10 / Menu key | Context menu (icon row: Cut, Copy, Rename, Delete; Compress / Extract for ZIP) |
| Ctrl+Shift+N / Ctrl+Shift+C | New folder / copy the selection as path |
| Ctrl+F | Search the active pane (Enter searches subfolders) |
| F5 | Refresh |

## Build history

3. DONE: keyboard navigation, multi-select, clipboard, rename, undo
3b. DONE: sidebar (quick access + drives with free space), breadcrumbs, search
    (instant folder filter; Enter = recursive search; Ctrl+F focuses the box)
3c. DONE: Home page (greeting, quick access, drives, recent folders), light/dark theme toggle
    (remembered; follows the system theme on first launch), Details / Compact / Icons layouts,
    sorting (toolbar or click a column header), colour-coded file icons
4. DONE: dual pane (toggle in the title bar) with drag and drop between panes, per-pane path bar and search
5. DONE: Quick Look (Space), accent colours (palette button), status bar with live fps + folder-open time
5b. DONE: thumbnails (images, video, PDF) - OS shell thumbnails on Windows/macOS, disk cache in userData/thumbs,
    3 at a time, de-duplicated, skipped when the tile scrolls away, pruned to 200 MB
5c. DONE: Enter / double-click opens files in their default app (also the Open button in Quick Look)
5d. DONE: right-click menus (files, folders, empty space, Recycle Bin) and the Explorer-style command bar
    (New, Cut, Copy, Paste, Rename, Delete). New folder / text document start in rename mode.
5e. DONE: resource meter in the status bar (ORBIT's own CPU and memory) and a System Monitor page
    (sidebar): CPU gauge + per-core load + 2-minute history, memory, storage, ORBIT's own processes.
    Live CPU clock, CPU temperature, GPU load + memory, disk and network come from Windows performance counters
    through the built-in `typeperf` (started only while the page is open; anything a PC doesn't provide shows N/A with
    the reason). If the PC has no temperature counter, CPU temp falls back to the ACPI thermal zone (WMI, via
    PowerShell, polled every 5 s while the page is open). Windows usually allows that only to an administrator,
    and the zone may be the board rather than the exact CPU core, so the tile says "ACPI zone" and, if refused,
    "Needs administrator rights". Fan speed, voltage, current and power need a hardware driver, so they are not shown. NOT yet run on a
    real Windows machine.
7. DONE: Recycle Bin view (Windows): list, restore, delete permanently, empty. Reads the bin straight from
    disk ($Recycle.Bin\<your SID>: $I record + $R data), no PowerShell. Ids are only accepted if they sit directly
    in your own bin folder; restore never overwrites; destructive actions ask first. Tested against fake bin
    folders on Linux, NOT yet on a real Windows machine.
8a. DONE: PDF reader (pdf.js, loaded on first use so start-up is unchanged). Enter / double-click on a PDF opens it
    in ORBIT; the right-click menu keeps "Open with default app". Only the pages on screen are drawn, with
    selectable text, zoom (fit width, + / -, Ctrl+wheel), page jump, search with highlights (matches within a
    line of text), password-protected files and a clear message for damaged ones. The PDF is read by the main
    process (size-capped at 300 MB) and passed over IPC. NOT yet run inside real Electron on Windows (the
    worker loads from file://), only in Chromium against the built page.
8b. DONE: Copilot (Groq tool calling; the model is chosen from Groq's live model list, because Groq retires models often). Sidebar "Copilot" or Ctrl+J opens a panel at the right.
    It is told what you are looking at (active folder, other pane, selection, the PDF and page open in the reader)
    and works through tools: list_folder, search_files, read_text_file, read_pdf, file_info (all read-only), and
    propose_changes. Changes (new folder, move, copy, rename, Recycle Bin) show up as a plan card; nothing happens
    until you click Apply, and there is no permanent delete. Every plan is re-checked against the real disk before
    you see it (paths exist, names legal, nothing moved into itself). Key/password files (.env, .ssh, *.pem ...) are
    never shown to the model. The Groq key is stored encrypted (Electron safeStorage) in the main process only; if
    the PC cannot encrypt, it lives in memory until ORBIT closes. Free-tier limits are reported plainly. Logic is
    unit-tested with a scripted fake model and fake network; NOT yet run against the real Groq API or inside real
    Electron on Windows.
8c. DONE: ZIP. Right-click any selection -> "Compress to ZIP" (single item: <name>.zip, several: Archive.zip, never
    overwrites). Right-click a .zip -> "Extract to folder" (new folder named after the archive) or "Extract here".
    Runs in the operation queue with a progress % in the status bar, Cancel, and Ctrl+Z (removes the archive, or
    only the files an extraction created). Extraction never overwrites, refuses unsafe paths (zip-slip, drive
    letters), skips symbolic links, handles Windows-illegal names, and cleans up after itself on failure or
    cancel. Password-protected ZIPs are refused (not supported yet). Unit-tested on Linux; NOT yet run on real
    Windows files.
8d. DONE: Windows installer (electron-builder, NSIS) with the logo icon, and a postinstall step that replaces
    the manual electron/esbuild install.js commands. The unpacked package layout was built and inspected on
    Linux; the installer itself has NOT been built or run on Windows yet.
8e. LATER: more themes, streaming Copilot replies, click a path in a reply to open it, password-protected ZIP, code signing