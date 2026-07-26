export type ReviewKeyboardAction =
  | "none"
  | "exit-keyboard"
  | "next-file"
  | "previous-file"
  | "focus-hunk"
  | "accept-file"
  | "accept-hunk"
  | "reject-hunk";

export interface ReviewKeyboardInput {
  key: string;
  shiftKey: boolean;
  hasModifier: boolean;
  isEditor: boolean;
  keyboardMode: boolean;
  hasContents: boolean;
  hasReviewFile: boolean;
}

export function reviewKeyboardAction(
  input: ReviewKeyboardInput,
): ReviewKeyboardAction {
  if (input.hasModifier || (input.isEditor && !input.keyboardMode)) return "none";
  if (input.key === "Escape" && input.keyboardMode) return "exit-keyboard";
  if (input.key === "j") return "next-file";
  if (input.key === "k") return "previous-file";
  if (input.key === "Enter" && input.hasContents) return "focus-hunk";
  if (!input.hasReviewFile) return "none";
  if (input.shiftKey && input.key.toLowerCase() === "a") return "accept-file";
  if (!input.shiftKey && input.key === "a") return "accept-hunk";
  if (!input.shiftKey && input.key === "r") return "reject-hunk";
  return "none";
}
