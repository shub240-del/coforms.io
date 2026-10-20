import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStatus = "idle" | "speaking" | "listening" | "pending_confirmation" | "error";

export interface ProposedAnswer {
  questionId: string;
  value: any;
  displayValue: string;
  isAmbiguous?: boolean;
  message?: string;
}

export interface QuestionContext {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  required?: boolean;
  options?: string[];
  settings?: Record<string, any>;
}

// Convert English spoken number words to integer
export function wordToNumber(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  const digitMatch = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (digitMatch) {
    const num = Number(digitMatch[0]);
    return Number.isFinite(num) ? num : null;
  }
  const map: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  return map[trimmed] !== undefined ? map[trimmed] : null;
}

// Normalize email spoken strings like "jane at example dot com"
export function normalizeSpokenEmail(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+at\s+/g, "@")
    .replace(/\s*@\s*/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, "");
}

export function parseSpokenAnswer(
  question: QuestionContext,
  rawTranscript: string,
  options: string[] = []
): { value: any; display: string; isAmbiguous?: boolean; message?: string } | null {
  const text = rawTranscript.trim();
  if (!text) return null;

  switch (question.type) {
    case "short_text":
    case "name":
    case "address":
      return { value: text, display: text };

    case "long_text":
      return { value: text, display: text.length > 60 ? `${text.slice(0, 57)}…` : text };

    case "email": {
      const email = normalizeSpokenEmail(text);
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return {
          value: email,
          display: email,
          isAmbiguous: true,
          message: "Please specify a complete email address (e.g. name at example dot com).",
        };
      }
      return { value: email, display: email };
    }

    case "number": {
      const n = wordToNumber(text);
      if (n === null || !Number.isFinite(n)) {
        return { value: text, display: text, isAmbiguous: true, message: "Could not recognize a valid number." };
      }
      const min = typeof question.settings?.min === "number" ? question.settings.min : undefined;
      const max = typeof question.settings?.max === "number" ? question.settings.max : undefined;
      if (min !== undefined && n < min) {
        return { value: n, display: String(n), isAmbiguous: true, message: `Number must be at least ${min}.` };
      }
      if (max !== undefined && n > max) {
        return { value: n, display: String(n), isAmbiguous: true, message: `Number must not exceed ${max}.` };
      }
      return { value: n, display: String(n) };
    }

    case "rating": {
      const n = wordToNumber(text);
      if (n === null || !Number.isInteger(n) || n < 1 || n > 5) {
        return {
          value: text,
          display: text,
          isAmbiguous: true,
          message: "Please choose a rating between 1 and 5 stars.",
        };
      }
      return { value: n, display: `${n} star${n === 1 ? "" : "s"}` };
    }

    case "opinion_scale": {
      const min = typeof question.settings?.min === "number" ? question.settings.min : 1;
      const max = typeof question.settings?.max === "number" ? question.settings.max : 5;
      const n = wordToNumber(text);
      if (n === null || !Number.isInteger(n) || n < min || n > max) {
        return {
          value: text,
          display: text,
          isAmbiguous: true,
          message: `Please choose a value between ${min} and ${max}.`,
        };
      }
      return { value: n, display: String(n) };
    }

    case "nps": {
      const n = wordToNumber(text);
      if (n === null || !Number.isInteger(n) || n < 0 || n > 10) {
        return {
          value: text,
          display: text,
          isAmbiguous: true,
          message: "Please choose a score from 0 to 10.",
        };
      }
      return { value: n, display: `${n} / 10` };
    }

    case "yes_no": {
      const lower = text.toLowerCase();
      if (["yes", "yeah", "yep", "sure", "definitely", "true", "correct"].some(w => lower.includes(w))) {
        return { value: "Yes", display: "Yes" };
      }
      if (["no", "nope", "nah", "negative", "false", "never"].some(w => lower.includes(w))) {
        return { value: "No", display: "No" };
      }
      return {
        value: text,
        display: text,
        isAmbiguous: true,
        message: 'Please answer with "Yes" or "No".',
      };
    }

    case "checkbox": {
      const lower = text.toLowerCase();
      if (["yes", "agree", "i agree", "check", "checked", "accept"].some(w => lower.includes(w))) {
        return { value: true, display: "Checked (Agreed)" };
      }
      return {
        value: false,
        display: "Unchecked",
        isAmbiguous: true,
        message: 'Say "I agree" or check the box to confirm.',
      };
    }

    case "single_choice":
    case "dropdown":
    case "image_choice": {
      const lower = text.toLowerCase().trim();
      const available = options.length ? options : ["Option 1", "Option 2", "Option 3"];

      // Exact match
      const exact = available.find(o => o.toLowerCase().trim() === lower);
      if (exact) return { value: exact, display: exact };

      // Substring match
      const matches = available.filter(o => {
        const optLower = o.toLowerCase().trim();
        return optLower.includes(lower) || lower.includes(optLower);
      });

      if (matches.length === 1) {
        return { value: matches[0], display: matches[0] };
      }
      if (matches.length > 1) {
        return {
          value: text,
          display: text,
          isAmbiguous: true,
          message: `Multiple options match ("${matches.join('", "')}"). Please specify clearly.`,
        };
      }
      return {
        value: text,
        display: text,
        isAmbiguous: true,
        message: `Could not match an option. Available choices: ${available.join(", ")}.`,
      };
    }

    case "multiple_choice": {
      const lower = text.toLowerCase();
      const available = options.length ? options : ["Option 1", "Option 2", "Option 3"];
      const matched = available.filter(o => lower.includes(o.toLowerCase()));
      if (matched.length > 0) {
        return { value: matched, display: matched.join(", ") };
      }
      return {
        value: [],
        display: text,
        isAmbiguous: true,
        message: `Could not match any options. Available choices: ${available.join(", ")}.`,
      };
    }

    case "file_upload":
    case "signature":
    case "payment":
      return null;

    default:
      return { value: text, display: text };
  }
}

export function useVoiceForm({
  currentQuestion,
  questionOptions = [],
  onApplyAnswer,
  onNext,
  isFormComplete = false,
}: {
  currentQuestion?: QuestionContext | null;
  questionOptions?: string[];
  onApplyAnswer: (questionId: string, value: any) => void;
  onNext: () => void;
  isFormComplete?: boolean;
}) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [proposedAnswer, setProposedAnswer] = useState<ProposedAnswer | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);
  const recognitionActiveRef = useRef(false);

  // Runtime feature detection
  useEffect(() => {
    const hasSTT = typeof window !== "undefined" && Boolean(
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    );
    const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;
    setIsSupported(hasSTT && hasTTS);
  }, []);

  // Safe speech synthesis
  const speakText = useCallback(
    (textToSpeak: string, onDone?: () => void) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        onDone?.();
        return;
      }
      if (isMuted) {
        onDone?.();
        return;
      }

      window.speechSynthesis.cancel();

      // Temporarily pause recognition to prevent feedback loop
      if (recognitionRef.current && recognitionActiveRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore abort error
        }
      }

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      isSpeakingRef.current = true;
      setStatus("speaking");

      utterance.onend = () => {
        isSpeakingRef.current = false;
        onDone?.();
      };
      utterance.onerror = () => {
        isSpeakingRef.current = false;
        onDone?.();
      };

      window.speechSynthesis.speak(utterance);
    },
    [isMuted]
  );

  // Start listening with Web Speech API
  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;
    const SpeechClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechClass) {
      setErrorMessage("Speech recognition is not supported in this browser.");
      setStatus("error");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }

    const recognition = new SpeechClass();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      recognitionActiveRef.current = true;
      setStatus("listening");
      setErrorMessage(null);
    };

    recognition.onerror = (event: any) => {
      recognitionActiveRef.current = false;
      if (event.error === "no-speech") {
        setErrorMessage("No speech detected. Say your answer or click below.");
      } else if (event.error === "not-allowed") {
        setErrorMessage("Microphone permission denied. Please allow microphone access.");
        setIsEnabled(false);
        setStatus("idle");
      } else if (event.error !== "aborted") {
        setErrorMessage(`Recognition error: ${event.error}`);
        setStatus("idle");
      }
    };

    recognition.onend = () => {
      recognitionActiveRef.current = false;
    };

    recognition.onresult = (event: any) => {
      const results = event.results;
      if (!results || !results[0] || !results[0][0]) return;
      const spokenText = results[0][0].transcript;
      setTranscript(spokenText);

      // If we are currently in pending confirmation mode, handle confirmation speech
      if (proposedAnswer) {
        const lower = spokenText.toLowerCase().trim();
        if (["yes", "confirm", "continue", "next", "correct", "keep"].some(w => lower.includes(w))) {
          confirmAnswer();
          return;
        }
        if (["no", "retry", "change", "try again", "edit", "clear"].some(w => lower.includes(w))) {
          retryAnswer();
          return;
        }
      }

      // Otherwise parse spoken input for current question
      if (!currentQuestion) return;

      const parsed = parseSpokenAnswer(currentQuestion, spokenText, questionOptions);
      if (!parsed) {
        setErrorMessage("This question requires on-screen interaction.");
        return;
      }

      setProposedAnswer({
        questionId: currentQuestion.id,
        value: parsed.value,
        displayValue: parsed.display,
        isAmbiguous: parsed.isAmbiguous,
        message: parsed.message,
      });

      // Apply interpreted answer immediately to local state so user sees it in the input
      if (!parsed.isAmbiguous) {
        onApplyAnswer(currentQuestion.id, parsed.value);
      }

      setStatus("pending_confirmation");

      if (parsed.isAmbiguous) {
        speakText(parsed.message || `I heard ${parsed.display}, but it was unclear. Could you repeat that?`, () => {
          if (isEnabled) startListening();
        });
      } else {
        speakText(`I heard ${parsed.display}. Confirm to continue, or say try again.`, () => {
          if (isEnabled) startListening();
        });
      }
    };

    try {
      recognition.start();
    } catch {
      // recognition already active
    }
  }, [currentQuestion, questionOptions, proposedAnswer, onApplyAnswer, speakText, isEnabled]);

  // Clean stop of all speech recognition and synthesis
  const stopAllSpeech = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    recognitionActiveRef.current = false;
    isSpeakingRef.current = false;
    setStatus("idle");
    setTranscript("");
    setProposedAnswer(null);
    setErrorMessage(null);
  }, []);

  // When voice mode is toggled on/off
  const toggleVoiceMode = useCallback(() => {
    if (isEnabled) {
      setIsEnabled(false);
      stopAllSpeech();
    } else {
      setIsEnabled(true);
      setErrorMessage(null);
      if (currentQuestion) {
        speakText(`Question: ${currentQuestion.title}`, () => {
          startListening();
        });
      }
    }
  }, [isEnabled, currentQuestion, speakText, startListening, stopAllSpeech]);

  // Speak new question when moving forward if voice is enabled
  useEffect(() => {
    if (!isEnabled || !currentQuestion || isFormComplete) return;
    setProposedAnswer(null);
    setTranscript("");

    // Instruct user to use screen for non-voice types
    if (["file_upload", "signature", "payment"].includes(currentQuestion.type)) {
      speakText(`${currentQuestion.title}. Please complete this question using the screen.`);
      return;
    }

    speakText(currentQuestion.title, () => {
      if (isEnabled) startListening();
    });
  }, [currentQuestion?.id, isEnabled, isFormComplete]);

  // Cleanup on unmount or complete
  useEffect(() => {
    if (isFormComplete) {
      stopAllSpeech();
      setIsEnabled(false);
    }
    return () => {
      stopAllSpeech();
    };
  }, [isFormComplete, stopAllSpeech]);

  // Respondent confirms proposed answer -> advance to next question
  const confirmAnswer = useCallback(() => {
    if (proposedAnswer && currentQuestion) {
      onApplyAnswer(currentQuestion.id, proposedAnswer.value);
    }
    setProposedAnswer(null);
    setTranscript("");
    setStatus("idle");
    onNext();
  }, [proposedAnswer, currentQuestion, onApplyAnswer, onNext]);

  // Respondent rejects proposed answer -> retry
  const retryAnswer = useCallback(() => {
    setProposedAnswer(null);
    setTranscript("");
    speakText("Let's try again. What is your answer?", () => {
      if (isEnabled) startListening();
    });
  }, [speakText, isEnabled, startListening]);

  return {
    isEnabled,
    isSupported,
    isMuted,
    status,
    transcript,
    proposedAnswer,
    errorMessage,
    toggleVoiceMode,
    toggleMute: () => setIsMuted(v => !v),
    confirmAnswer,
    retryAnswer,
    startListening,
  };
}
