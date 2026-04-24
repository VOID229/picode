export type QuestionKeyboardAction =
  | { type: "select-option"; index: number }
  | { type: "open-custom" }
  | { type: "commit-custom" }
  | { type: "previous" }
  | { type: "next" }
  | { type: "dismiss" }
  | { type: "none" };

export function resolveQuestionKeyboardAction(options: {
  key: string;
  editingCustom: boolean;
  optionCount: number;
  hasCurrentAnswer: boolean;
  hasModifier?: boolean;
}): QuestionKeyboardAction {
  if (options.hasModifier) {
    return { type: "none" };
  }

  if (options.editingCustom) {
    if (options.key === "Enter") {
      return { type: "commit-custom" };
    }
    if (options.key === "Escape") {
      return { type: "dismiss" };
    }
    return { type: "none" };
  }

  if (/^[1-3]$/.test(options.key)) {
    const index = Number(options.key) - 1;
    if (index < options.optionCount) {
      return { type: "select-option", index };
    }
  }

  if (options.key === "4") {
    return { type: "open-custom" };
  }

  if (options.key === "ArrowLeft") {
    return { type: "previous" };
  }

  if (options.key === "ArrowRight" && options.hasCurrentAnswer) {
    return { type: "next" };
  }

  if (options.key === "Escape") {
    return { type: "dismiss" };
  }

  return { type: "none" };
}
