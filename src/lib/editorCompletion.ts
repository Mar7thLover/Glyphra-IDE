import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";

import { useEditorStore } from "@/lib/stores/editorStore";
import { useFileIndexStore } from "@/lib/stores/fileIndexStore";

const MAX_WORDS = 220;
const MAX_PATHS = 120;
const MAX_BUFFER_CHARS = 128 * 1024;

const COMMON_KEYWORDS = [
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "else",
  "export",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "let",
  "new",
  "null",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "undefined",
  "while",
];

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  rs: [
    "crate", "enum", "impl", "match", "mod", "move", "mut", "pub", "ref",
    "self", "Self", "struct", "trait", "type", "use", "where",
  ],
  py: [
    "and", "as", "assert", "class", "def", "del", "elif", "except", "from",
    "global", "in", "is", "lambda", "None", "not", "or", "pass", "raise",
    "with", "yield",
  ],
  go: [
    "chan", "defer", "fallthrough", "func", "go", "interface", "map", "package",
    "range", "select", "struct", "type", "var",
  ],
  java: [
    "abstract", "extends", "final", "implements", "instanceof", "interface",
    "package", "private", "protected", "public", "static", "synchronized",
  ],
};

const SNIPPETS: Record<string, Array<{ label: string; template: string; detail: string }>> = {
  js: [
    {
      label: "function",
      template: "function ${name}(${params}) {\n\t${}\n}",
      detail: "Function declaration",
    },
    {
      label: "forof",
      template: "for (const ${item} of ${items}) {\n\t${}\n}",
      detail: "for…of loop",
    },
    {
      label: "trycatch",
      template: "try {\n\t${}\n} catch (${error}) {\n\t${}\n}",
      detail: "try / catch",
    },
  ],
  rs: [
    {
      label: "fn",
      template: "fn ${name}(${params}) -> ${Result<()>} {\n\t${}\n}",
      detail: "Rust function",
    },
    {
      label: "impl",
      template: "impl ${Type} {\n\t${}\n}",
      detail: "Rust impl block",
    },
    {
      label: "match",
      template: "match ${value} {\n\t${pattern} => ${},\n}",
      detail: "Rust match",
    },
  ],
  py: [
    {
      label: "def",
      template: "def ${name}(${params}):\n\t${}",
      detail: "Python function",
    },
    {
      label: "ifmain",
      template: "if __name__ == \"__main__\":\n\t${main()}",
      detail: "Python entry point",
    },
  ],
};

function extension(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function languageFamily(path: string) {
  const ext = extension(path);
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte"].includes(ext)) return "js";
  return ext;
}

function wordsFrom(value: string) {
  return value.slice(0, MAX_BUFFER_CHARS).match(/[A-Za-z_$][\w$]{2,}/g) ?? [];
}

export interface CompletionBuildInput {
  path: string;
  currentContent: string;
  buffers: Array<{ path: string; content: string }>;
  indexedFiles: string[];
}

export function buildCompletionOptions(input: CompletionBuildInput): Completion[] {
  const seen = new Set<string>();
  const options: Completion[] = [];
  const push = (option: Completion) => {
    const key = option.label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push(option);
  };

  const family = languageFamily(input.path);
  for (const snippet of SNIPPETS[family] ?? []) {
    push(snippetCompletion(snippet.template, {
      label: snippet.label,
      detail: snippet.detail,
      type: "keyword",
      boost: 90,
    }));
  }
  for (const keyword of [
    ...COMMON_KEYWORDS,
    ...(LANGUAGE_KEYWORDS[extension(input.path)] ?? []),
  ]) {
    push({ label: keyword, type: "keyword", boost: 50 });
  }

  const wordCounts = new Map<string, number>();
  for (const word of wordsFrom(input.currentContent)) {
    wordCounts.set(word, (wordCounts.get(word) ?? 0) + 3);
  }
  for (const buffer of input.buffers.slice(0, 8)) {
    if (buffer.path === input.path) continue;
    for (const word of wordsFrom(buffer.content)) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }
  [...wordCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_WORDS)
    .forEach(([label, count]) => {
      push({
        label,
        type: /^[A-Z]/.test(label) ? "type" : "variable",
        detail: count > 1 ? "Workspace symbol" : "Open buffer",
        boost: Math.min(40, count),
      });
    });

  input.indexedFiles.slice(0, MAX_PATHS).forEach((path) => {
    push({
      label: path.replace(/\\/g, "/"),
      type: "text",
      detail: "Workspace path",
      boost: 10,
    });
  });
  return options;
}

export function glyphraCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const token = context.matchBefore(/[A-Za-z0-9_$@./-]*/);
  if (!token || (!context.explicit && token.text.length < 2)) return null;
  const editor = useEditorStore.getState();
  const currentPath = editor.activePath ?? "";
  const currentContent =
    editor.tabs.find((tab) => tab.path === currentPath)?.content
    ?? context.state.doc.toString();
  const options = buildCompletionOptions({
    path: currentPath,
    currentContent,
    buffers: editor.tabs.map((tab) => ({ path: tab.path, content: tab.content })),
    indexedFiles: useFileIndexStore.getState().files,
  });
  return {
    from: token.from,
    options,
    validFor: /^[A-Za-z0-9_$@./-]*$/,
  };
}
