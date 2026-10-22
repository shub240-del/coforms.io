import React, { useState, useEffect, useRef } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit2,
  FileText,
  Globe,
  LoaderCircle,
  Mail,
  RotateCcw,
  Sparkles,
  User,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  LanguageCode,
  SUPPORTED_LANGUAGES,
  TRANSLATIONS,
} from "./interviewI18n";
import "./AiStoryInterview.css";

export interface AiStoryInterviewProps {
  form: any;
  questions: any[];
  visible: any[];
  answers: Record<string, any>;
  onAnswerChange: (questionId: string, value: any) => void;
  currentIndex: number;
  onNext: () => Promise<void>;
  onBack: () => void;
  onJumpToQuestion: (index: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  isEvaluating: boolean;
  onSwitchToClassic: () => void;
  uploadFile: (file: File) => Promise<void>;
  uploadBusy: boolean;
  FieldInputComponent: React.ComponentType<{
    question: any;
    value: any;
    onChange: (value: any) => void;
    disabled?: boolean;
    onFile?: (file: File) => Promise<void>;
  }>;
  isComplete: boolean;
}

export function AiStoryInterview({
  form,
  questions,
  visible,
  answers,
  onAnswerChange,
  currentIndex,
  onNext,
  onBack,
  onJumpToQuestion,
  onSubmit,
  isSubmitting,
  isEvaluating,
  onSwitchToClassic,
  uploadFile,
  uploadBusy,
  FieldInputComponent,
  isComplete,
}: AiStoryInterviewProps) {
  // Mode: "onboarding" | "chat"
  const [viewState, setViewState] = useState<"onboarding" | "chat">("onboarding");
  const [selectedLang, setSelectedLang] = useState<LanguageCode>("en");
  const [respondentName, setRespondentName] = useState("");
  const [respondentEmail, setRespondentEmail] = useState("");

  const t = TRANSLATIONS[selectedLang] || TRANSLATIONS.en;
  const currentQuestion = visible[currentIndex];
  const isLastQuestion = currentIndex >= visible.length - 1;
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat to latest question or transition
  useEffect(() => {
    if (viewState === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [currentIndex, viewState]);

  // Link name and email to matching form questions before starting.
  const handleStartInterview = (e: React.FormEvent) => {
    e.preventDefault();
    if (respondentEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(respondentEmail.trim())) {
        toast.error("Please enter a valid email address.");
        return;
      }
    }

    // Auto-fill questions if user entered name/email on welcome screen
    if (respondentName.trim()) {
      const nameQ = questions.find(
        (q) => q.type === "name" || q.title?.toLowerCase().includes("your name")
      );
      if (nameQ && !answers[nameQ.id]) {
        onAnswerChange(nameQ.id, respondentName.trim());
      }
    }
    if (respondentEmail.trim()) {
      const emailQ = questions.find(
        (q) => q.type === "email" || q.title?.toLowerCase().includes("email")
      );
      if (emailQ && !answers[emailQ.id]) {
        onAnswerChange(emailQ.id, respondentEmail.trim());
      }
    }

    setViewState("chat");
  };

  // Helper to format user's answer for chat bubble
  const formatDisplayAnswer = (question: any, value: any) => {
    if (value === undefined || value === null || value === "") return "(No answer)";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") {
      if (value.name) return `📎 ${value.name}`;
      return JSON.stringify(value);
    }
    return String(value);
  };

  // Check if current question has valid answer
  const isCurrentAnswerValid = () => {
    if (!currentQuestion) return false;
    const value = answers[currentQuestion.id];
    if (!currentQuestion.required) return true;
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (currentQuestion.type === "checkbox" && value !== true) return false;
    return true;
  };

  const handleNextClick = async () => {
    if (!currentQuestion) return;
    const value = answers[currentQuestion.id];
    if (
      currentQuestion.required &&
      (value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && !value.length) ||
        (currentQuestion.type === "checkbox" && value !== true))
    ) {
      toast.error("Please provide an answer before continuing.");
      return;
    }

    if (isLastQuestion) {
      onSubmit();
    } else {
      await onNext();
    }
  };

  // Render Completed Card if form is finished
  if (isComplete) {
    return (
      <div className="sf-story-container">
        <header className="sf-story-topbar">
          <div className="sf-story-brand-cluster">
            <span className="sf-story-mode-pill">
              <Sparkles size={12} /> {t.badge}
            </span>
          </div>
        </header>
        <main className="sf-story-welcome-wrapper">
          <div className="sf-story-completed-card">
            <div className="sf-story-check-circle">
              <Check size={28} />
            </div>
            <h1 className="sf-story-completed-title">{t.thankYouDefault}</h1>
            <p className="sf-story-completed-subtitle">
              {form.settings?.thankYouText || t.responseRecorded}
            </p>
          </div>
        </main>
      </div>
    );
  }

  // =========================================================================
  // VIEW 1: WELCOME & ONBOARDING SCREEN
  // =========================================================================
  if (viewState === "onboarding") {
    return (
      <div className="sf-story-container">
        <header className="sf-story-topbar">
          <div className="sf-story-brand-cluster">
            <span className="sf-story-mode-pill">
              <Sparkles size={12} /> {t.badge}
            </span>
          </div>
          <div className="sf-story-topbar-controls">
            <select
              className="sf-story-lang-select"
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value as LanguageCode)}
              aria-label="Select language"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.native}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="sf-story-switch-btn"
              onClick={onSwitchToClassic}
              title="Fill out in standard form layout"
            >
              <FileText size={13} /> {t.switchToClassic}
            </button>
          </div>
        </header>

        <main className="sf-story-welcome-wrapper">
          <div className="sf-story-welcome-card">
            <div className="sf-story-welcome-badge">
              <Sparkles size={12} /> {t.badge}
            </div>

            <h1 className="sf-story-welcome-title">{form.title || "Survey"}</h1>
            <p className="sf-story-welcome-desc">
              {form.description || t.welcomeSubtitle}
            </p>

            <div className="sf-story-meta-pills">
              <span className="sf-story-meta-pill">
                📋 {visible.length} {visible.length === 1 ? "question" : "questions"}
              </span>
              <span className="sf-story-meta-pill">⚡ ~2 min</span>
              <span className="sf-story-meta-pill">
                🌐 {SUPPORTED_LANGUAGES.find((l) => l.code === selectedLang)?.native}
              </span>
            </div>

            <form onSubmit={handleStartInterview}>
              <div className="sf-story-field-group">
                <div className="sf-story-field-item">
                  <label className="sf-story-field-label">
                    <User size={14} /> {t.nameLabel}
                  </label>
                  <div className="sf-story-input-wrap">
                    <User size={16} />
                    <input
                      type="text"
                      placeholder={t.namePlaceholder}
                      value={respondentName}
                      onChange={(e) => setRespondentName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                </div>

                <div className="sf-story-field-item">
                  <label className="sf-story-field-label">
                    <Mail size={14} /> {t.emailLabel}
                  </label>
                  <div className="sf-story-input-wrap">
                    <Mail size={16} />
                    <input
                      type="email"
                      placeholder={t.emailPlaceholder}
                      value={respondentEmail}
                      onChange={(e) => setRespondentEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                </div>
              </div>

              <div className="sf-story-welcome-actions">
                <button
                  type="submit"
                  className="sf-story-btn-primary-3d"
                  id="sf-start-interview-btn"
                >
                  <Sparkles size={16} />
                  <span>{t.startInterview}</span>
                  <ArrowRight size={15} />
                </button>

                <button
                  type="button"
                  className="sf-story-link-secondary"
                  onClick={onSwitchToClassic}
                >
                  {t.switchToClassic} →
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: GUIDED CONVERSATION
  // =========================================================================
  const progressPercent = Math.min(
    100,
    Math.round(((currentIndex + 1) / Math.max(visible.length, 1)) * 100)
  );

  return (
    <div className="sf-story-container">
      {/* Top sticky header */}
      <header className="sf-story-topbar">
        <div className="sf-story-brand-cluster">
          <span className="sf-story-mode-pill">
            <Sparkles size={12} /> {t.badge}
          </span>
          <span className="sf-story-meta-pill" style={{ margin: 0 }}>
            {t.questionOf(currentIndex + 1, visible.length)}
          </span>
        </div>

        <div className="sf-story-topbar-controls">
          <select
            className="sf-story-lang-select"
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value as LanguageCode)}
            aria-label="Change language"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.flag} {l.code.toUpperCase()}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="sf-story-switch-btn"
            onClick={onSwitchToClassic}
            title="Switch to classic form view"
          >
            <FileText size={13} /> {t.switchToClassic}
          </button>
        </div>
      </header>

      {/* Progress Strip */}
      <div className="sf-story-progress-strip">
        <div
          className="sf-story-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Conversational Stream */}
      <main className="sf-story-chat-main">
        <div className="sf-story-messages-container">
          {/* AI Intro Bubble */}
          <div className="sf-story-msg sf-story-msg-ai">
            <div className="sf-story-ai-avatar">
              <Bot size={18} />
            </div>
            <div className="sf-story-bubble sf-story-bubble-ai">
              {t.greeting(respondentName, form.title || "this survey")}
            </div>
          </div>

          {/* Past Answered Questions */}
          {visible.slice(0, currentIndex).map((prevQ, idx) => {
            const answerVal = answers[prevQ.id];
            const transitionMsg =
              t.transitions[idx % t.transitions.length] || t.transitions[0];

            return (
              <React.Fragment key={prevQ.id}>
                {/* AI asked the question */}
                <div className="sf-story-msg sf-story-msg-ai">
                  <div className="sf-story-ai-avatar">
                    <Bot size={18} />
                  </div>
                  <div className="sf-story-bubble sf-story-bubble-ai">
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#8c887e", marginBottom: 4 }}>
                      {t.questionOf(idx + 1, visible.length)}
                    </div>
                    <b>{prevQ.title}</b>
                  </div>
                </div>

                {/* User answered */}
                <div className="sf-story-msg sf-story-msg-user">
                  <div className="sf-story-bubble sf-story-bubble-user">
                    <div className="sf-story-user-content">
                      <span>{formatDisplayAnswer(prevQ, answerVal)}</span>
                      <button
                        type="button"
                        className="sf-story-edit-btn"
                        onClick={() => onJumpToQuestion(idx)}
                        title="Edit this answer"
                      >
                        <Edit2 size={11} /> {t.editAnswer}
                      </button>
                    </div>
                  </div>
                  <div className="sf-story-user-avatar">
                    {respondentName ? respondentName.charAt(0).toUpperCase() : "U"}
                  </div>
                </div>

                {/* AI transition */}
                <div className="sf-story-msg sf-story-msg-ai">
                  <div className="sf-story-ai-avatar">
                    <Bot size={18} />
                  </div>
                  <div className="sf-story-transition-bubble">
                    <Sparkles size={13} /> {transitionMsg}
                  </div>
                </div>
              </React.Fragment>
            );
          })}

          {/* Active Question Card */}
          {currentQuestion && (
            <div className="sf-story-active-card" id={`q-card-${currentQuestion.id}`}>
              <div className="sf-story-card-header">
                <span className="sf-story-q-badge">
                  {t.questionOf(currentIndex + 1, visible.length).toUpperCase()}
                </span>
                <span
                  className={`sf-story-q-req ${
                    currentQuestion.required ? "req" : "opt"
                  }`}
                >
                  {currentQuestion.required ? t.required : t.optional}
                </span>
              </div>

              <h2 className="sf-story-q-title">{currentQuestion.title}</h2>
              {currentQuestion.description && (
                <p className="sf-story-q-desc">{currentQuestion.description}</p>
              )}

              {/* Interactive Input Widget */}
              <div className="sf-story-active-input-wrap">
                {renderInteractiveWidget({
                  question: currentQuestion,
                  value: answers[currentQuestion.id],
                  onChange: (val) => onAnswerChange(currentQuestion.id, val),
                  onConfirm: handleNextClick,
                  onFile: uploadFile,
                  disabled: isSubmitting || isEvaluating || uploadBusy,
                  FieldInputComponent,
                  t,
                })}
              </div>

              {/* Action row at bottom of card */}
              <div className="sf-story-card-actions">
                <div>
                  {currentIndex > 0 ? (
                    <button
                      type="button"
                      className="sf-story-btn-back"
                      onClick={onBack}
                    >
                      <ChevronLeft size={14} /> Back
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: "#8c887e" }}>
                      {currentQuestion.required ? "* Required question" : "Optional question"}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="sf-story-btn-next-3d"
                  onClick={handleNextClick}
                  disabled={isSubmitting || isEvaluating || uploadBusy}
                >
                  {isSubmitting || isEvaluating || uploadBusy ? (
                    <LoaderCircle size={15} className="sf-spin" />
                  ) : isLastQuestion ? (
                    <Check size={15} />
                  ) : (
                    <ArrowRight size={15} />
                  )}
                  <span>
                    {isSubmitting
                      ? t.submitting
                      : isLastQuestion
                      ? t.submitBtn
                      : t.continueBtn}
                  </span>
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>
    </div>
  );
}

// =========================================================================
// INTERACTIVE WIDGET COMPONENT
// =========================================================================
function renderInteractiveWidget({
  question,
  value,
  onChange,
  onConfirm,
  onFile,
  disabled,
  FieldInputComponent,
  t,
}: {
  question: any;
  value: any;
  onChange: (val: any) => void;
  onConfirm: () => void;
  onFile: (file: File) => Promise<void>;
  disabled: boolean;
  FieldInputComponent: React.ComponentType<any>;
  t: any;
}) {
  const options: string[] = Array.isArray(question.options)
    ? question.options
    : Array.isArray(question.settings?.options)
    ? question.settings.options
    : ["Option 1", "Option 2", "Option 3"];

  // Single choice / yes_no
  if (
    question.type === "single_choice" ||
    question.type === "yes_no" ||
    question.type === "image_choice"
  ) {
    const choices = question.type === "yes_no" ? ["Yes", "No"] : options;

    return (
      <div className="sf-story-choices-grid">
        {choices.map((choice) => {
          const isSelected = value === choice;
          return (
            <button
              key={choice}
              type="button"
              className={`sf-story-choice-btn ${isSelected ? "selected" : ""}`}
              onClick={() => onChange(choice)}
              disabled={disabled}
            >
              <span className="sf-story-choice-indicator">
                {isSelected && <Check size={12} />}
              </span>
              <span>{choice}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // Rating (1-5)
  if (question.type === "rating") {
    return (
      <div className="sf-story-rating-row">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={`sf-story-rating-btn ${Number(value) >= star ? "active" : ""}`}
            onClick={() => onChange(star)}
            disabled={disabled}
          >
            ★ {star}
          </button>
        ))}
      </div>
    );
  }

  // Opinion Scale / NPS
  if (question.type === "opinion_scale" || question.type === "nps") {
    const min = question.type === "nps" ? 0 : Number(question.settings?.min ?? 1);
    const max = question.type === "nps" ? 10 : Number(question.settings?.max ?? 5);
    const count = max - min + 1;
    const items = Array.from({ length: count }, (_, i) => min + i);

    return (
      <div className="sf-story-rating-row">
        {items.map((n) => (
          <button
            key={n}
            type="button"
            className={`sf-story-rating-btn ${Number(value) === n ? "active" : ""}`}
            onClick={() => onChange(n)}
            disabled={disabled}
          >
            {n}
          </button>
        ))}
      </div>
    );
  }

  // Short text, email, phone, number, url, name
  if (
    [
      "short_text",
      "email",
      "phone",
      "number",
      "url",
      "name",
      "address",
    ].includes(question.type)
  ) {
    const inputType =
      question.type === "email"
        ? "email"
        : question.type === "phone"
        ? "tel"
        : question.type === "number"
        ? "number"
        : question.type === "url"
        ? "url"
        : "text";

    return (
      <div className="sf-story-text-container">
        <input
          type={inputType}
          className="sf-story-chat-input"
          placeholder={t.typeAnswerPlaceholder}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm();
            }
          }}
          disabled={disabled}
          autoFocus
        />
        <div className="sf-story-input-hint">
          <span>{t.pressEnter}</span>
        </div>
      </div>
    );
  }

  // Long text / textarea
  if (question.type === "long_text") {
    return (
      <div className="sf-story-text-container">
        <textarea
          rows={3}
          className="sf-story-chat-input"
          placeholder={t.typeAnswerPlaceholder}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoFocus
        />
      </div>
    );
  }

  // Checkbox consent
  if (question.type === "checkbox") {
    return (
      <label className="sf-story-choice-btn" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          style={{ width: 18, height: 18, accentColor: "#e7bd45" }}
        />
        <span>I agree and confirm this answer</span>
      </label>
    );
  }

  // Default: Use existing robust FieldInput component (multiple_choice, file_upload, signature, dropdown, matrix, etc.)
  return (
    <FieldInputComponent
      question={question}
      value={value}
      onChange={onChange}
      disabled={disabled}
      onFile={onFile}
    />
  );
}
