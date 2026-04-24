import { describe, expect, it } from "bun:test";
import { resolveQuestionKeyboardAction } from "./questionComposerLogic";

describe("resolveQuestionKeyboardAction", () => {
  it("selects numbered options when not editing custom text", () => {
    expect(
      resolveQuestionKeyboardAction({
        key: "2",
        editingCustom: false,
        optionCount: 3,
        hasCurrentAnswer: false,
      }),
    ).toEqual({ type: "select-option", index: 1 });
  });

  it("lets number keys type normally while editing option 4", () => {
    expect(
      resolveQuestionKeyboardAction({
        key: "2",
        editingCustom: true,
        optionCount: 3,
        hasCurrentAnswer: false,
      }),
    ).toEqual({ type: "none" });
  });

  it("opens the free-text fallback from option 4", () => {
    expect(
      resolveQuestionKeyboardAction({
        key: "4",
        editingCustom: false,
        optionCount: 3,
        hasCurrentAnswer: false,
      }),
    ).toEqual({ type: "open-custom" });
  });

  it("only navigates forward after the current question is answered", () => {
    expect(
      resolveQuestionKeyboardAction({
        key: "ArrowRight",
        editingCustom: false,
        optionCount: 3,
        hasCurrentAnswer: false,
      }),
    ).toEqual({ type: "none" });
    expect(
      resolveQuestionKeyboardAction({
        key: "ArrowRight",
        editingCustom: false,
        optionCount: 3,
        hasCurrentAnswer: true,
      }),
    ).toEqual({ type: "next" });
  });
});
