import { ChevronLeft, ChevronRight, CornerDownLeft, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PendingQuestionRequest } from "../../domains/types";
import { cn } from "../../lib/cn";
import { resolveQuestionKeyboardAction } from "./questionComposerLogic";

interface QuestionComposerProps {
  request: PendingQuestionRequest;
  onResolve: (value: string | null) => Promise<void>;
}

interface QuestionAnswer {
  value: string;
  label: string;
  index: number;
  wasCustom: boolean;
}

export function QuestionComposer({
  request,
  onResolve,
}: QuestionComposerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const [editingCustom, setEditingCustom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const question = request.questions[currentIndex];
  const total = request.questions.length;
  const questionId = question?.id ?? String(currentIndex);
  const selected = question ? answers[question.id] : undefined;
  const options = question?.options.slice(0, 3) ?? [];
  const customOptionLabel =
    options.length === 2 &&
    options[1]?.label.trim().toLowerCase() === "no, do something differently"
      ? options[1].label
      : null;
  const visibleOptions = customOptionLabel ? options.slice(0, 1) : options;
  const customOptionNumber = customOptionLabel ? 2 : visibleOptions.length + 1;

  const allAnswered = useMemo(
    () => request.questions.every((entry) => answers[entry.id]),
    [answers, request.questions],
  );

  useEffect(() => {
    setCurrentIndex(0);
    setAnswers({});
    setCustomText({});
    setEditingCustom(false);
  }, [request.requestId]);

  useEffect(() => {
    if (editingCustom) {
      inputRef.current?.focus();
    }
  }, [editingCustom, currentIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!question) {
        return;
      }

      const action = resolveQuestionKeyboardAction({
        key: event.key,
        editingCustom,
        optionCount: visibleOptions.length,
        hasCurrentAnswer: Boolean(answers[question.id]),
        hasModifier: event.metaKey || event.ctrlKey || event.altKey,
      });

      switch (action.type) {
        case "select-option":
          event.preventDefault();
          selectOption(action.index);
          break;
        case "open-custom":
          event.preventDefault();
          setEditingCustom(true);
          break;
        case "commit-custom":
          event.preventDefault();
          commitCustomAnswer();
          break;
        case "dismiss":
          event.preventDefault();
          if (editingCustom) {
            setEditingCustom(false);
          } else {
            void onResolve(null);
          }
          break;
        case "previous":
          event.preventDefault();
          goPrevious();
          break;
        case "next":
          event.preventDefault();
          goNext();
          break;
        case "none":
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!question) {
    return null;
  }

  function advance() {
    setEditingCustom(false);
    setCurrentIndex((current) => Math.min(total - 1, current + 1));
  }

  function selectOption(optionIndex: number) {
    const option = visibleOptions[optionIndex];
    if (!option || !question) return;
    setAnswers((current) => ({
      ...current,
      [question.id]: {
        value: option.label,
        label: option.label,
        index: optionIndex + 1,
        wasCustom: false,
      },
    }));
    if (currentIndex < total - 1) {
      advance();
    }
  }

  function commitCustomAnswer() {
    if (!question) return;
    const value = (customText[question.id] ?? "").trim();
    if (!value) return;
    setAnswers((current) => ({
      ...current,
      [question.id]: {
        value,
        label: value,
        index: customOptionNumber,
        wasCustom: true,
      },
    }));
    if (currentIndex < total - 1) {
      advance();
    } else {
      setEditingCustom(false);
    }
  }

  function goPrevious() {
    setEditingCustom(false);
    setCurrentIndex((current) => Math.max(0, current - 1));
  }

  function goNext() {
    if (!answers[questionId]) return;
    setEditingCustom(false);
    setCurrentIndex((current) => Math.min(total - 1, current + 1));
  }

  async function submit() {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        answers: request.questions.map((entry) => {
          const answer = answers[entry.id];
          return {
            id: entry.id,
            header: entry.header,
            question: entry.question,
            value: answer?.value ?? "",
            label: answer?.label ?? "",
            index: answer?.index ?? 4,
            wasCustom: answer?.wasCustom ?? true,
          };
        }),
      };
      await onResolve(JSON.stringify(payload));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="question-composer" aria-label="Question">
      <div className="question-composer__top">
        <h2>{question.question}</h2>
        <div className="question-composer__nav">
          <button
            type="button"
            aria-label="Previous question"
            disabled={currentIndex === 0}
            onClick={goPrevious}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {currentIndex + 1} of {total}
          </span>
          <button
            type="button"
            aria-label="Next question"
            disabled={!answers[questionId] || currentIndex === total - 1}
            onClick={goNext}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="question-composer__options">
        {visibleOptions.map((option, index) => (
          <button
            key={`${option.label}-${index}`}
            type="button"
            className={cn(
              "question-composer__option",
              selected?.index === index + 1 &&
                !selected.wasCustom &&
                "question-composer__option--selected",
            )}
            onClick={() => selectOption(index)}
          >
            <span>{index + 1}.</span>
            <strong>{option.label}</strong>
            {option.description && <small>{option.description}</small>}
          </button>
        ))}

        <div
          className={cn(
            "question-composer__option question-composer__option--custom",
            (editingCustom || selected?.wasCustom) &&
              "question-composer__option--selected",
          )}
          onClick={() => setEditingCustom(true)}
        >
          <span>{customOptionNumber}.</span>
          {editingCustom ? (
            <input
              ref={inputRef}
              value={customText[question.id] ?? ""}
              onChange={(event) =>
                setCustomText((current) => ({
                  ...current,
                  [question.id]: event.target.value,
                }))
              }
              placeholder={customOptionLabel ?? "Type your answer"}
            />
          ) : (
            <strong
              className={cn(
                customOptionLabel &&
                  !selected?.wasCustom &&
                  "question-composer__custom-example",
              )}
            >
              {selected?.wasCustom
                ? selected.value
                : (customOptionLabel ??
                  "No, and tell Codex what to do differently")}
            </strong>
          )}
        </div>
      </div>

      <div className="question-composer__footer">
        <button
          type="button"
          className="question-composer__dismiss"
          onClick={() => void onResolve(null)}
        >
          Dismiss <span>ESC</span>
        </button>
        {editingCustom ? (
          <button
            type="button"
            className="question-composer__submit"
            disabled={!(customText[question.id] ?? "").trim()}
            onClick={commitCustomAnswer}
          >
            Save <CornerDownLeft size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="question-composer__submit"
            disabled={!allAnswered || submitting}
            onClick={() => void submit()}
          >
            {submitting ? "Submitting" : "Submit"} <CornerDownLeft size={14} />
          </button>
        )}
        <button
          type="button"
          className="question-composer__close"
          aria-label="Dismiss question"
          onClick={() => void onResolve(null)}
        >
          <X size={18} />
        </button>
      </div>
    </section>
  );
}
