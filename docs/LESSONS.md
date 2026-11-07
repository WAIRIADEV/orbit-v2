# ORBIT: mistakes, errors and lessons

Every problem caught while building ORBIT, what caused it, and how it was fixed. Kept so the same mistake is
not made twice. Newest first within each group. "Tests" means the Node unit tests unless it says browser.

## A. Mistakes from the first ORBIT build (why it was rebuilt)

| Problem | Cause | Lesson / what the rebuild does |
| --- | --- | --- |
| Too slow and unoptimised | Whole folders rendered at once, thumbnails loaded eagerly | Rebuild is performance-first: virtual lists, streamed listing, lazy thumbnails, a stated budget |
| Recycle Bin did not work | Custom bin that had to be kept in sync with Windows | Deleting uses the OS Recycle Bin (`shell.trashItem`); the bin view reads what Windows holds |
| Video needed `webSecurity: false` | Local `file://` media blocked by the browser sandbox | Keep `webSecurity` on; serve media through the app instead of weakening security |

## B. Errors found while building the rebuild

### Environment and install (hit on the real Windows PC)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Error: Electron uninstall` on `npm run dev` | npm blocked dependency install scripts, so Electron's binary and esbuild's binary were never downloaded | Interim: `node node_modules\electron\install.js` and `node node_modules\esbuild\install.js`. Permanent: `scripts/postinstall.mjs` runs both after `npm install` and never fails the install |
| Groq: "The model `llama-3.3-70b-versatile` does not exist or you do not have access to it" | Groq retires models often; a hard-coded model name went stale | The model is picked from Groq's live `/models` list (`ModelPicker`) with a preference order, plus one retry if the chosen model disappears |
| CPU temperature tile shows N/A | The PC does not expose an ACPI thermal zone | Added the ACPI fallback and an honest "N/A + reason" instead of a fake number. Other PCs may work; not a bug in ORBIT |

### Bugs caught by tests or browser checks before they reached the PC

| Symptom | Cause | Fix |
| --- | --- | --- |
| `cancel` did nothing to a running copy/move/zip | `cancel()` only searched the waiting list; a running job is removed from it before it starts | Queue remembers the current job and cancels it. Found while writing the ZIP cancel test |
| Opening a corrupt ZIP showed a raw library message | The "open file" step sat outside the code that turns errors into friendly messages | Moved inside; test checks the message "not a valid ZIP file" |
| Encrypted-ZIP test failed with a size error | The hand-built test archive was malformed, not ORBIT | Test fixture fixed; encrypted archives are refused with "password protected" |
| Backslash in a ZIP entry name test failed | Test expected rejection, but `dir\file` is safely turned into `dir/file` | Test now uses `..\win.txt`, which really is unsafe |
| `scrollIntoView` shifted the whole app shell | It scrolls every ancestor, not just the list | Replaced with a `reveal()` that scrolls only the list's scroller |
| PDF reader stole keys typed in the Copilot box | Global key handler ran while typing | Handler ignores keys from `.aipanel` and while the reader is open; Space/Enter on buttons left to the button |
| Rename plan failed off Windows | `join(path, '..', newName)` mishandles backslash paths on Linux | Use `join(parentPath(path), newName)` |
| TypeScript: `Omit` over a union lost fields | `Omit` is not distributive | `DistributiveOmit` helper |
| `aiText.test` could not import `@shared/paths` | Node tests do not know the Vite alias | Runtime imports in tested renderer files are relative `.ts` imports; type-only alias imports are fine |
| Groq retry test never retried | The fake retired model name matched no model family, so it was never chosen first | Test uses a real family name (`llama-3.3-70b-versatile`) |
| ZIP: `onAbort` handlers returned the stream | Arrow functions without braces returned a value | Added braces; typecheck clean |
| ZIP: extraction cleanup used recursive `rm` | Would delete a folder the user had added files to after extracting | `removeCreated()` unlinks only files it made and removes only empty folders |
| Browser test PDFs vanished | Every build wipes `out/renderer`, where test PDFs lived | Test PDFs are regenerated after each build before browser checks |
| `EMFILE` (too many open files) risk when zipping big folders | Opening every file stream up front | `yazl` `addReadStreamLazy` opens each file only when it is reached |

## C. Rules these taught us

1. **Never trust a name or path from outside.** ZIP entries, AI plans and IPC arguments are checked: no `..`, no
   drive letters, no Windows-reserved names, nothing outside the target folder. Plans from the Copilot are re-checked
   against the real disk before you see them.
2. **Never overwrite, never delete what you did not create.** Copy/move/extract number the name (`name (1)`); undo
   removes only what the operation made.
3. **Clean up after failure.** A cancelled or failed zip leaves no `.partial`; a failed extraction removes what it made.
4. **Do not hard-code things other people retire** (AI model names). Ask the service what exists.
5. **Say when something is unverified.** Several features were tested on Linux and in Chromium, not on real Windows
   or inside real Electron. The README lists them. Say "N/A: reason" instead of showing a guess.
6. **Keep the security model strict.** Renderer never touches Node; secrets stay in the main process; keys are
   stored with the OS encryption (`safeStorage`) and never written in plain text.
7. **Write the test that would have caught it.** Every bug above became a test (188 passing at last count).
8. **A pinned, small dependency list is a feature.** Runtime dependency: only `pdfjs-dist`. Everything else is
   bundled at build time.

## D. Known unverified or open items

- Installer (`npm run dist`) not yet built or run on Windows; unpacked package layout was inspected on Linux.
- pdf.js worker loading from `file://` inside real Electron; main-process PDF text extraction.
- Real Groq API behaviour with the dynamically chosen model.
- Thumbnails, video and PDF behaviour inside real Electron; Recycle Bin view against a real Windows bin.
- ZIP on real Windows files (long paths, locked files, very large archives).
- Installer is unsigned (SmartScreen warning). `asar` is off so pdf.js loads as plain files; revisit later.
