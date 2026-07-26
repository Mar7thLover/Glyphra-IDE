# IME hand-test checklist (M2+)

> Part of the docs set — see [README](./README.md). Required gate before merging
> editor / decoration / theme changes that touch CodeMirror composition.

WebView2 + CodeMirror 6 + CJK IMEs (Microsoft Pinyin, Sogou, Rime) need a
fixed gate before each milestone that ships editor changes.

## Before testing

- Build a release or `pnpm tauri dev` on Windows 10/11.
- Install at least one CJK IME (微软拼音 or 搜狗).
- Confirm `@codemirror/view` is the pinned range in `package.json`.

## Editor

1. Open a `.ts` / `.md` / `.rs` file; switch to 微软拼音.
2. Type a multi-candidate phrase (e.g. `nihao` → 你好); confirm candidates stay
   under the caret and committing inserts the phrase once.
3. Mid-composition, press Esc — composition cancels; no half-committed Latin
   leftovers in the buffer.
4. Mid-composition, click another tab — composition ends cleanly; no crash.
5. Enable word wrap; repeat steps 2–3 near a wrapped line.
6. Dark theme + light theme; IME candidate window still tracks the caret.
7. Save (`Ctrl+S`) while not composing; dirty marker clears.

## Inline edit / ghost text

8. Press `Ctrl+K` over a selection and type the instruction with 微软拼音 —
   candidates track the input field and Enter commits the phrase instead of
   submitting the instruction.
9. Enable **Settings → Editor → Inline completion**, then compose a CJK phrase
   in the buffer. No ghost text may appear while composing; a suggestion may
   only arrive after the phrase is committed and typing pauses.
10. With ghost text visible, start a composition — the suggestion disappears
    before the first preedit character lands.

## Agent / review (smoke)

11. With composition active in the editor, open Agent and type ASCII there —
    editor composition should not steal focus incorrectly.
12. Review merge view: type with IME in the center editor after accepting a
    hunk; no decoration flicker during composition.

## Pass criteria

- No doubled characters, stuck Latin preedit, or caret jumps during composition.
- `CodeEditor` must not apply custom decoration/update side-effects while
  `view.composing` is true (`imeSafeUpdateListener`).

## Fail → block merge

Any fail on steps 2–4 blocks shipping editor/theme/decoration changes until
fixed. A fail on step 9 or 10 blocks inline-completion changes. File a note in
the PR with IME name + OS build.
