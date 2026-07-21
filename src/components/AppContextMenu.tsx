import {
  ClipboardPaste,
  Copy,
  MessageSquarePlus,
  Redo2,
  Scissors,
  TextSelect,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { copyText, readClipboardText } from "@/lib/clipboard";
import { focusAgentComposer, useComposerDraft } from "@/lib/stores/composerStore";
import { useUiStore } from "@/lib/stores/uiStore";

import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

type TextControl = HTMLInputElement | HTMLTextAreaElement;

function isTextControl(target: EventTarget | null): target is TextControl {
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return ["text", "search", "url", "tel", "email", "password", "number"].includes(target.type);
}

function controlSelection(control: TextControl) {
  const start = control.selectionStart ?? 0;
  const end = control.selectionEnd ?? start;
  return { start, end, text: control.value.slice(start, end) };
}

function replaceControlSelection(control: TextControl, text: string) {
  const { start, end } = controlSelection(control);
  control.focus();
  control.setRangeText(text, start, end, "end");
  control.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
  );
}

function attachText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return;
  useComposerDraft.getState().addReference({
    kind: "selection",
    label: compact.length > 36 ? `${compact.slice(0, 36)}…` : compact,
    content: text,
  });
  useUiStore.getState().openAgent();
  focusAgentComposer();
}

export default function AppContextMenu() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    control: TextControl | null;
    text: string;
  } | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();

      const control = isTextControl(event.target) ? event.target : null;
      const text = control
        ? controlSelection(control).text
        : window.getSelection()?.toString().trim() ?? "";
      if (!control && !text) {
        setMenu(null);
        return;
      }
      setMenu({ x: event.clientX, y: event.clientY, control, text });
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  if (!menu) return null;
  const editable = Boolean(menu.control && !menu.control.disabled && !menu.control.readOnly);
  const items: ContextMenuItem[] = menu.control
    ? [
        {
          id: "undo",
          label: t("menu.undo"),
          shortcut: "Ctrl+Z",
          icon: <Undo2 className="size-3.5" />,
          disabled: !editable,
          action: () => {
            menu.control?.focus();
            document.execCommand("undo");
          },
        },
        {
          id: "redo",
          label: t("menu.redo"),
          shortcut: "Ctrl+Y",
          icon: <Redo2 className="size-3.5" />,
          disabled: !editable,
          action: () => {
            menu.control?.focus();
            document.execCommand("redo");
          },
        },
        { id: "history-separator", separator: true },
        {
          id: "cut",
          label: t("menu.cut"),
          shortcut: "Ctrl+X",
          icon: <Scissors className="size-3.5" />,
          disabled: !editable || !menu.text,
          action: async () => {
            if (!menu.control || !menu.text) return;
            await copyText(menu.text);
            replaceControlSelection(menu.control, "");
          },
        },
        {
          id: "copy",
          label: t("menu.copy"),
          shortcut: "Ctrl+C",
          icon: <Copy className="size-3.5" />,
          disabled: !menu.text,
          action: () => copyText(menu.text),
        },
        {
          id: "paste",
          label: t("menu.paste"),
          shortcut: "Ctrl+V",
          icon: <ClipboardPaste className="size-3.5" />,
          disabled: !editable,
          action: async () => {
            if (!menu.control) return;
            const text = await readClipboardText();
            if (text) replaceControlSelection(menu.control, text);
          },
        },
        { id: "edit-separator", separator: true },
        {
          id: "select-all",
          label: t("menu.selectAll"),
          shortcut: "Ctrl+A",
          icon: <TextSelect className="size-3.5" />,
          action: () => menu.control?.select(),
        },
        { id: "agent-separator", separator: true },
        {
          id: "attach",
          label: t("agent.attachSelection"),
          icon: <MessageSquarePlus className="size-3.5" />,
          disabled: !menu.text,
          action: () => attachText(menu.text),
        },
      ]
    : [
        {
          id: "copy",
          label: t("menu.copy"),
          shortcut: "Ctrl+C",
          icon: <Copy className="size-3.5" />,
          action: () => copyText(menu.text),
        },
        {
          id: "attach",
          label: t("agent.attachSelection"),
          icon: <MessageSquarePlus className="size-3.5" />,
          action: () => attachText(menu.text),
        },
      ];

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={items}
      onClose={() => setMenu(null)}
    />
  );
}
