import {
  Braces,
  CircleX,
  GitBranch,
  GitPullRequestArrow,
  Languages,
  Moon,
  Sun,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { lspLanguageId, lspLanguageLabel } from "@/features/editor/lspLanguage";
import { diagnosticCounts } from "@/lib/diagnostics";
import { useDiagnosticsStore } from "@/lib/stores/diagnosticsStore";
import { TEXT_ENCODINGS, useEditorStore } from "@/lib/stores/editorStore";
import { useGitStore } from "@/lib/stores/gitStore";
import { useLspStore } from "@/lib/stores/lspStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { unresolvedReviewGroupCount, useReviewStore } from "@/lib/stores/reviewStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";

export default function StatusBar() {
  const { t, i18n } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const toggleTerminal = useTerminalStore((s) => s.toggle);
  const setTerminalOpen = useTerminalStore((s) => s.setOpen);
  const diagnostics = useDiagnosticsStore((s) => s.diagnostics);
  const problemsOpen = useDiagnosticsStore((s) => s.problemsOpen);
  const setProblemsOpen = useDiagnosticsStore((s) => s.setProblemsOpen);
  const openReview = useReviewStore((s) => s.openReview);
  const turns = useReviewStore((s) => s.turns);
  const workingTree = useReviewStore((s) => s.workingTree);
  const decisions = useReviewStore((s) => s.decisions);
  const projectPath = useProjectStore((s) => s.current?.path);
  const branch = useGitStore((s) => s.branch);
  const activePath = useEditorStore((s) => s.activePath);
  const cursor = useEditorStore((s) => s.cursor);
  const docInfo = useEditorStore((s) => s.docInfo);
  const activeTab = useEditorStore((s) => s.tabs.find((tab) => tab.path === s.activePath) ?? null);
  const setLineEnding = useEditorStore((s) => s.setLineEnding);
  const setEncoding = useEditorStore((s) => s.setEncoding);
  const reopenWithEncoding = useEditorStore((s) => s.reopenWithEncoding);
  const tabSize = usePrefsStore((s) => s.tabSize);
  const setPref = usePrefsStore((s) => s.setPref);
  const persist = usePrefsStore((s) => s.persist);
  const unresolved = unresolvedReviewGroupCount({ turns, workingTree, decisions });
  const problemCounts = diagnosticCounts(diagnostics);

  const toggleLang = () => {
    const next = i18n.language === "zh-CN" ? "en" : "zh-CN";
    void i18n.changeLanguage(next);
    localStorage.setItem("glyphra.lang", next);
    persist(theme, next);
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setPref("customTheme", null);
    setTheme(next);
    persist(next, i18n.language);
  };

  const cycleIndent = () => {
    if (docInfo?.editorConfigIndent) return;
    const size = docInfo?.indentSize ?? tabSize;
    setPref("tabSize", size === 2 ? 4 : size === 4 ? 8 : 2);
  };

  const toggleLineEnding = () => {
    if (!activePath || !docInfo || activeTab?.readOnly) return;
    setLineEnding(activePath, docInfo.eol === "LF" ? "CRLF" : "LF");
  };

  // Language-server state for the active buffer. Nothing renders for file
  // types with no server, so the bar stays quiet on plain text and markdown.
  const lspLanguage = activeTab && !activeTab.truncated && !activeTab.longLines
    ? lspLanguageId(activeTab.name)
    : null;
  const lspStatus = useLspStore((s) =>
    lspLanguage ? (s.statuses[lspLanguage] ?? null) : null,
  );
  const lspReady = lspStatus?.state === "ready";
  const lspLabel = lspLanguage
    ? (lspStatus?.server ?? lspLanguageLabel(lspLanguage))
    : null;
  const lspTitle = !lspStatus
    ? t("settings.languageServerIdle")
    : lspReady
      ? t("settings.languageServerReady")
      : (lspStatus.message ?? t("settings.languageServerStopped"));

  const item =
    "flex h-full items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-hover hover:text-ink-2";

  return (
    <footer className="glass-panel flex h-6 shrink-0 items-center gap-1 border-t border-line px-2 text-[11px] text-ink-3">
      <span className="inline-flex items-center gap-1.5 px-1">
        <span className="size-1.5 rounded-full bg-ok/80" />
        {t("status.ready")}
      </span>
      {branch && (
        <span
          className="inline-flex items-center gap-1 px-1 font-mono text-[10.5px] text-ink-2"
          title={branch.upstream ? `${branch.name} ↔ ${branch.upstream}` : branch.name}
        >
          <GitBranch className="size-3 text-ink-3" />
          {branch.name}
          {(branch.ahead > 0 || branch.behind > 0) && (
            <span className="text-ink-3">
              {branch.ahead > 0 && <span className="text-ok">↑{branch.ahead}</span>}
              {branch.behind > 0 && <span className="text-danger">↓{branch.behind}</span>}
            </span>
          )}
        </span>
      )}
      <span className="text-ink-3/60">{t("app.stage")}</span>
      <div className="flex-1" />
      {activePath && (
        <>
          {cursor && (
            <span
              className="px-1.5 font-mono text-[10.5px] text-ink-2"
              title={t("status.lineColHint")}
            >
              {t("status.lineCol", { line: cursor.line, col: cursor.col })}
              {cursor.selChars > 0 && ` ${t("status.selected", { n: cursor.selChars })}`}
            </span>
          )}
          <button
            type="button"
            onClick={cycleIndent}
            disabled={docInfo?.editorConfigIndent}
            title={
              docInfo?.editorConfigIndent
                ? t("status.editorConfigIndentHint")
                : t("status.indentHint")
            }
            className={item}
          >
            {t(docInfo?.indentStyle === "tab" ? "status.indentTabs" : "status.indentSpaces", {
              size: docInfo?.indentSize ?? tabSize,
            })}
          </button>
          {activeTab && !activeTab.preview && (
            <select
              value={`convert:${activeTab.encoding}`}
              onChange={(event) => {
                const [action, encoding] = event.target.value.split(":", 2);
                if (!encoding) return;
                if (action === "reopen") {
                  void reopenWithEncoding(activeTab.path, encoding);
                } else {
                  setEncoding(activeTab.path, encoding);
                }
              }}
              disabled={activeTab.readOnly}
              title={t("status.encodingHint")}
              aria-label={t("status.encodingHint")}
              className="h-5 max-w-28 rounded border-0 bg-transparent px-1 text-[10.5px] text-ink-3 outline-none hover:bg-hover disabled:opacity-50"
            >
              <optgroup label={t("status.saveEncoding")}>
                {TEXT_ENCODINGS.map((encoding) => (
                  <option key={`convert:${encoding}`} value={`convert:${encoding}`}>
                    {encoding}
                    {encoding === activeTab.encoding && activeTab.bom ? " BOM" : ""}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("status.reopenEncoding")}>
                {TEXT_ENCODINGS.map((encoding) => (
                  <option key={`reopen:${encoding}`} value={`reopen:${encoding}`}>
                    {encoding}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
          {docInfo && (
            <button
              type="button"
              onClick={toggleLineEnding}
              disabled={activeTab?.readOnly}
              title={t("status.eolHint")}
              className={`${item} font-mono text-[10.5px] disabled:cursor-default disabled:opacity-50`}
            >
              {docInfo.eol}
            </button>
          )}
          {docInfo && (
            <span className="px-1 text-[10.5px] text-ink-2">
              {docInfo.languageName ?? t("status.plainText")}
            </span>
          )}
        </>
      )}
      <button
        type="button"
        onClick={() => openReview(projectPath)}
        title={`${t("review.title")} · Ctrl+Shift+R`}
        className={`${item} relative`}
      >
        <GitPullRequestArrow className="size-3" />
        {unresolved > 0 && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warn" />}
        {unresolved > 0 ? (
          <span className="inline-flex min-w-[14px] items-center justify-center rounded-full bg-accent-soft px-1 text-[10px] font-medium text-accent">
            {unresolved}
          </span>
        ) : (
          t("review.title")
        )}
      </button>
      {lspLabel && (
        <button
          type="button"
          onClick={() => useUiStore.getState().openSettings("editor")}
          title={lspTitle}
          className={item}
        >
          <Braces className={`size-3 ${lspReady ? "" : "text-ink-3"}`} />
          {lspLabel}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          const next = !problemsOpen;
          setProblemsOpen(next);
          if (next) setTerminalOpen(false);
        }}
        title={t("problems.title")}
        className={item}
      >
        <CircleX className={`size-3 ${problemCounts.error ? "text-danger" : ""}`} />
        {problemCounts.error}
        <TriangleAlert className={`ml-0.5 size-3 ${problemCounts.warning ? "text-warn" : ""}`} />
        {problemCounts.warning}
      </button>
      <button
        type="button"
        onClick={() => {
          setProblemsOpen(false);
          toggleTerminal();
        }}
        title={t("terminal.title")}
        className={item}
      >
        <TerminalSquare className="size-3" />
        {t("terminal.title")}
      </button>
      <button onClick={toggleLang} title={t("settings.language")} className={item}>
        <Languages className="size-3" />
        {i18n.language === "zh-CN" ? "中文" : "EN"}
      </button>
      <button onClick={toggleTheme} title={t("settings.theme")} className={item}>
        {theme === "dark" ? <Moon className="size-3" /> : <Sun className="size-3" />}
      </button>
    </footer>
  );
}
