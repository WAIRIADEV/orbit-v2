# ORBIT

A fast dual-pane file manager for Windows, built with Electron, Vite, TypeScript and React. Performance first:
virtual lists, streamed folder listing and lazy thumbnails, so a 50,000-file folder stays smooth.
Built by Antony Wairia

> Status: working, tested on windows
> [Known unverified](#known-unverified) and [docs/LESSONS.md](docs/LESSONS.md) (every error caught along the way).

## Features

- Dual pane with drag and drop (Ctrl = copy), breadcrumbs, instant filter and recursive search
- Copy, cut, paste, rename, delete to the Recycle Bin, undo (Ctrl+Z), one operation queue with progress and Cancel
- ZIP: compress any selection, extract to a folder or here (never overwrites, refuses unsafe archives)
- Quick Look (Space), thumbnails for images, video and PDF, built-in PDF reader (search, zoom, selectable text)
- Recycle Bin view that shows what Windows holds: restore, delete permanently, empty
- System Monitor: CPU, per-core load, clock, temperature (when the PC exposes it), GPU, memory, disk, network
- Copilot sidebar (Groq LLM agent, see [AI engineering](#ai-engineering-how-the-copilot-works)): understands the folder you are in, reads files and PDFs, and proposes changes as a plan
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

See [Using the Copilot](#using-the-copilot-ai) below.

**System Monitor.** Live while the page is open. Anything your PC does not provide shows N/A with the reason (CPU
temperature often needs an ACPI zone or administrator rights; fans, voltage and power need a hardware driver, so
they are not shown).

**Installing.** `npm run dist`, run `dist\ORBIT-Setup-0.1.0.exe`, then start ORBIT from the Start menu. The
installed app has its own settings, separate from `npm run dev`. The installer is unsigned: SmartScreen says
"More info" then "Run anyway".

## Using the Copilot (AI)

The Copilot is an assistant that can look at your files and propose changes. It uses [Groq](https://groq.com), which
has a free tier. You bring your own key; ORBIT never ships one.

**Set it up (one time, about a minute)**

1. Go to **console.groq.com/keys**, sign in and click **Create API Key**. Copy it. It starts with `gsk_`.
2. In ORBIT open **Copilot** in the sidebar (or press **Ctrl+J**).
3. Paste the key into the box that says `gsk_…` and press **Save key** (or Enter). ORBIT checks it with Groq
   and tells you if it is wrong.
4. Done. The box is replaced by the chat. To remove the key later, click **Remove key** at the top of the panel
   (it asks you to click twice).

Where the key lives: encrypted on your PC with Windows' own protection (Electron `safeStorage`), used only by ORBIT's
main process, never shown in the interface again and never written to a plain text file. If a PC cannot encrypt,
the panel says so and keeps the key only until ORBIT closes. Never put the key in the code or in GitHub.

**What it can do**

It always knows what you are looking at: the folder in the active pane, the other pane, your selection, and the
PDF and page open in the reader. It can list folders, search for files, read text files, read PDFs and check file
details. Files are sent to Groq only when the Copilot reads one to answer you. Key and password files (`.env`,
`.ssh`, `*.pem` and similar) are never shown to it.

**Things to try**

- "What is in this folder, and what looks like clutter?"
- "Find my invoices from 2025 and put them in a folder called Invoices."
- "Summarise this PDF" (open it in the reader first), or "which of these PDFs mentions warranty?"
- "Rename these screenshots by date." (select them first)
- "Make a folder for each file type here and sort everything into them."

**Making changes safely.** When the Copilot wants to change something (new folder, move, copy, rename, send to
the Recycle Bin) it shows a **plan card** listing every step. Nothing happens until you press **Apply**. Every plan is
re-checked against the real disk first (paths exist, names are legal, nothing moves into itself). It cannot delete
permanently, and the steps go through the normal queue, so **Ctrl+Z** undoes moves, copies and renames. Items sent
to the Recycle Bin are restored from the Recycle Bin view.

**Limits and troubleshooting**

| Message or problem | What it means / what to do |
| --- | --- |
| "bad key" or it asks for the key again | The key was removed or is invalid on Groq's side. Create a new one and paste it |
| Rate limit or "try again in N seconds" | Free-tier limits. Wait, or ask something smaller |
| Model error | Groq retires models often. ORBIT picks one from Groq's live list, so just try again |
| Slow or cut-off answers | It stops after 6 reasoning steps and 12 tool calls per question to stay fast. Ask a narrower question |
| Nothing happens after a plan | You still need to press **Apply** on the plan card |

## AI engineering: how the Copilot works

ORBIT's Copilot is a small, safe **LLM agent**: a language model that can use tools on your computer, wrapped in
guardrails written as ordinary, tested code. It is one of the core AI engineering projects in the SAINT SYSTEMS portfolio.

**The idea.** You write in plain language. A large language model (NLP) works out the intent, and decides which tool
to call. ORBIT's code runs the tool, feeds the result back, and repeats until the model has an answer or a plan. The
model never touches your files directly.

```
 you ──"sort my invoices by year"──▶ Copilot panel (renderer)
                                          │ typed IPC
                                          ▼
                              Agent loop (main process)
        context + tool list ──▶ Groq LLM ──▶ tool call? ──yes──▶ run tool on disk ──┐
                                   ▲                                                │
                                   └────────────── result goes back ◀───────────────┘
                                          │ no more tool calls
                                          ▼
                       propose_changes ──▶ validate against the real disk ──▶ plan card
                                                                                  │ you press Apply
                                                                                  ▼
                                                              normal operation queue (undoable)
```

| Concept | How ORBIT does it |
| --- | --- |
| Natural language understanding | An open LLM on Groq. No custom NLP code, no intent rules |
| Tool calling | Six tools: `list_folder`, `search_files`, `read_text_file`, `read_pdf`, `file_info` (all read-only) and `propose_changes` |
| Context grounding | Every request carries the active folder, the other pane, the selection and the PDF page open in the reader |
| Agent loop | The model may call tools repeatedly, capped at 6 steps and 12 tool calls per question |
| Model selection | Chosen at runtime from Groq's live model list in a preference order, with one retry if the model is retired. A hard-coded name broke once (see LESSONS) |
| Human in the loop | The model can only *propose*. Changes appear as a plan card and run only after Apply |
| Plan validation | Every proposed path, name and move is re-checked against the real disk before you see it. Models can hallucinate paths, so the model's output is never trusted |
| Least privilege | Read-only tools, no permanent delete, no shell, no network access for tools |
| Secret handling | Key/password files are blocked from the model; the Groq key is encrypted and held only in the main process |
| Testability | The agent runs against a scripted fake model and a fake network in unit tests, so the logic is tested without calling a real API |
| Failure handling | Rate limits, bad keys and retired models produce plain-language messages instead of crashes |

**Why this design.** An LLM is good at understanding messy language and bad at being trusted with a delete button.
The split is deliberate: the model handles language and planning, deterministic code handles safety, and a human
approves anything that changes data. The same pattern (tools, validation, approval) applies to any agent that acts on
real systems.

**Skills this project demonstrates:** LLM tool calling and agent loops, prompt and context design, guardrails and
output validation, secure key handling, provider-agnostic model selection, testing non-deterministic systems with
fakes, and shipping the result as a desktop app.

**What is not done yet:** streaming replies, conversation memory across sessions, a retrieval step for very large
folders, and an automated evaluation set that scores the Copilot on a fixed list of tasks. Those are the natural
next steps for the AI side of the project.

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
| Licence | MIT (see `LICENSE`) |

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

Status key: **Owner-checked** = confirmed working on the owner's Windows PC. **Tests** = unit-tested on Linux
(and shown in Chromium) but not yet confirmed on real Windows.

| # | Feature | What it does | Status |
| --- | --- | --- | --- |
| 1 | Foundation | Electron + Vite + React shell, typed IPC, sandboxed renderer, streamed folder listing | Owner-checked |
| 2 | Operation queue | One queue for copy, move, rename, trash with progress, cancel and undo | Owner-checked |
| 3 | Keyboard and selection | Arrow keys, multi-select, clipboard, rename, undo | Owner-checked |
| 3b | Sidebar, breadcrumbs, search | Quick access, drives with free space, path bar, instant filter, Enter = search subfolders | Owner-checked |
| 3c | Home page and themes | Greeting, quick access, drives, recent folders; light/dark; Details, Compact and Icons layouts; sorting | Owner-checked |
| 4 | Dual pane | Toggle in the title bar, drag and drop between panes, per-pane path bar and search | Owner-checked |
| 5 | Quick Look and status bar | Space preview, accent colours, live fps and folder-open time | Owner-checked |
| 5b | Thumbnails | Images, video and PDF via OS thumbnails; 3 at a time; disk cache pruned to 200 MB | Tests |
| 5c | Open in default app | Enter or double-click opens files in their own app | Tests |
| 5d | Menus and command bar | Right-click menus and the Explorer-style bar (New, Cut, Copy, Paste, Rename, Delete) | Tests |
| 5e | System Monitor | CPU gauge, per-core load, history, memory, storage, GPU, disk, network, ORBIT's own usage. CPU temp falls back to the ACPI zone, otherwise shows N/A with the reason | Owner-checked (CPU temp is N/A on the dev PC) |
| 6 | Recycle Bin view | List, restore, delete permanently, empty; reads the bin from disk | Tests |
| 7 | PDF reader | pdf.js, loaded on first use; zoom, page jump, search, selectable text, password and damaged-file messages | Tests |
| 8 | Copilot | Groq tool-calling assistant with plan cards; model picked from Groq's live list | Owner-checked ("seems to work") |
| 9 | Logo and Home polish | ORBIT logo in the title bar and Home page, themed by the accent colour | Owner-checked |
| 10 | ZIP | Compress any selection, extract to a folder or here, safe against unsafe archives | Tests |
| 11 | Installer | NSIS installer with the logo icon, portable build, postinstall that fetches Electron and esbuild | Owner-checked (built on Windows) |

Later: more themes, streaming Copilot replies, clicking a path in a reply to open it, password-protected ZIPs,
code signing for the installer.
