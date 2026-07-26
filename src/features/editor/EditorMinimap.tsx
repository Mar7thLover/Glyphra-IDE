import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface EditorMinimapProps {
  view: EditorView;
  revision: string;
}

function canvasSize(canvas: HTMLCanvasElement) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { ratio, width, height };
}

export default function EditorMinimap({ view, revision }: EditorMinimapProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const { ratio, width, height } = canvasSize(canvas);
      context.clearRect(0, 0, width, height);
      const doc = view.state.doc;
      const styles = getComputedStyle(document.documentElement);
      const ink = styles.getPropertyValue("--ink-3").trim() || "#64748b";
      const accent = styles.getPropertyValue("--accent").trim() || "#2563eb";
      context.globalAlpha = 0.55;
      context.fillStyle = ink;

      const rows = Math.max(1, Math.floor(height / ratio));
      for (let row = 0; row < rows; row += 2) {
        const lineNumber = Math.min(
          doc.lines,
          Math.max(1, Math.floor((row / rows) * doc.lines) + 1),
        );
        const line = doc.line(lineNumber).text.trimStart();
        if (!line) continue;
        const lineWidth = Math.min(width / ratio - 6, 3 + Math.sqrt(line.length) * 4.5);
        context.fillRect(3 * ratio, row * ratio, lineWidth * ratio, ratio);
      }

      const first = doc.lineAt(view.viewport.from).number;
      const last = doc.lineAt(view.viewport.to).number;
      const top = ((first - 1) / Math.max(1, doc.lines)) * height;
      const viewportHeight = Math.max(
        12 * ratio,
        ((last - first + 1) / Math.max(1, doc.lines)) * height,
      );
      context.globalAlpha = 0.2;
      context.fillStyle = accent;
      context.fillRect(0, top, width, Math.min(height - top, viewportHeight));
      context.globalAlpha = 0.7;
      context.strokeStyle = accent;
      context.strokeRect(0.5 * ratio, top + 0.5 * ratio, width - ratio, viewportHeight - ratio);
      context.globalAlpha = 1;
    };

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    view.scrollDOM.addEventListener("scroll", draw, { passive: true });
    draw();
    return () => {
      observer.disconnect();
      view.scrollDOM.removeEventListener("scroll", draw);
    };
  }, [revision, view]);

  const revealAt = (clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const line = view.state.doc.line(
      Math.max(1, Math.min(view.state.doc.lines, Math.round(fraction * view.state.doc.lines))),
    );
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  };

  return (
    <canvas
      ref={canvasRef}
      role="scrollbar"
      aria-label={t("editor.minimap")}
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={view.state.doc.lines}
      aria-valuenow={view.state.doc.lineAt(view.viewport.from).number}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        revealAt(event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const current = view.state.doc.lineAt(view.viewport.from).number;
        const next = Math.max(
          1,
          Math.min(view.state.doc.lines, current + (event.key === "ArrowUp" ? -10 : 10)),
        );
        const line = view.state.doc.line(next);
        view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start" }) });
      }}
      className="absolute inset-y-0 right-0 z-10 h-full w-[72px] cursor-pointer border-l border-line/60 bg-panel/70 outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
    />
  );
}
