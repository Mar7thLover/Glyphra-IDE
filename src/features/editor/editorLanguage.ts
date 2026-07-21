import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

const EXTENSION_ALIASES: Record<string, string> = {
  astro: "HTML",
  cshtml: "HTML",
  razor: "HTML",
  svelte: "HTML",
  mdx: "Markdown",
  markdownlint: "Markdown",
  hcl: "Properties files",
  tf: "Properties files",
  tfvars: "Properties files",
  dotenv: "Properties files",
  env: "Properties files",
  cfg: "Properties files",
  conf: "Properties files",
  editorconfig: "Properties files",
  gql: "JavaScript",
  graphql: "JavaScript",
  prisma: "SQL",
  templ: "Go",
  glsl: "C",
  vert: "C",
  frag: "C",
  wgsl: "C",
  sol: "C++",
  lock: "TOML",
  xaml: "XML",
};

const EXACT_FILENAME_ALIASES: Record<string, string> = {
  ".babelrc": "JSON",
  ".eslintrc": "JSON",
  ".prettierrc": "JSON",
  ".stylelintrc": "JSON",
  ".editorconfig": "Properties files",
  ".env": "Properties files",
  ".gitattributes": "Properties files",
  ".gitconfig": "Properties files",
  ".gitignore": "Properties files",
  ".npmrc": "Properties files",
  ".yarnrc": "YAML",
  "cargo.lock": "TOML",
  "gemfile": "Ruby",
  "pipfile": "TOML",
  "procfile": "Shell",
};

function byName(name: string) {
  return languages.find((language) => language.name === name) ?? null;
}

function languageFromShebang(content: string) {
  const firstLine = content.slice(0, content.indexOf("\n") === -1 ? content.length : content.indexOf("\n"));
  if (!firstLine.startsWith("#!")) return null;
  if (/\b(python|python3)\b/i.test(firstLine)) return byName("Python");
  if (/\b(node|deno|bun)\b/i.test(firstLine)) return byName("JavaScript");
  if (/\b(bash|sh|zsh|fish)\b/i.test(firstLine)) return byName("Shell");
  if (/\bruby\b/i.test(firstLine)) return byName("Ruby");
  if (/\bperl\b/i.test(firstLine)) return byName("Perl");
  if (/\bphp\b/i.test(firstLine)) return byName("PHP");
  return null;
}

export function resolveEditorLanguage(filename: string, content = ""): LanguageDescription | null {
  const direct = LanguageDescription.matchFilename(languages, filename);
  if (direct) return direct;

  const lower = filename.toLowerCase();
  const exact = EXACT_FILENAME_ALIASES[lower];
  if (exact) return byName(exact);

  const extension = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  const alias = EXTENSION_ALIASES[extension];
  if (alias) return byName(alias);

  const shebang = languageFromShebang(content);
  if (shebang) return shebang;

  const trimmed = content.trimStart();
  if (trimmed.startsWith("<?xml")) return byName("XML");
  if (/^<!doctype\s+html/i.test(trimmed)) return byName("HTML");
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && filename.startsWith(".")) {
    return byName("JSON");
  }
  return null;
}
