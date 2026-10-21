import React, {
  useState, useEffect, useRef, useCallback, useMemo
} from "react";
import {
  Bot, Check, FileText, Globe, LoaderCircle,
  Mail, Mic, MicOff, MessageSquare, Send, Sparkles, User,
  Volume2, VolumeX, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  LanguageCode, SUPPORTED_LANGUAGES, TRANSLATIONS, BROWSER_LOCALE_MAP
} from "./interviewI18n";
import { wordToNumber, normalizeSpokenEmail, parseSpokenAnswer } from "@/hooks/useVoiceForm";
import "./InteractiveVoiceAgent.css";

// Sarvam-supported language codes (those that Bulbul TTS handles well)
const SARVAM_TTS_LANGS = new Set(["hi", "bn", "gu", "kn", "ml", "mr", "od", "pa", "ta", "te", "en"]);

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type AgentState = "welcome" | "greeting" | "asking" | "listening" | "processing" | "acknowledged" | "complete";
type InterviewMode = "voice" | "text";

interface TranscriptEntry {
  role: "ai" | "user";
  text: string;
}

export interface InteractiveVoiceAgentProps {
  slug?: string;
  responseId?: string;
  progressToken?: string;
  form: any;
  questions: any[];
  visible: any[];
  answers: Record<string, any>;
  onAnswerChange: (questionId: string, value: any) => void;
  currentIndex: number;
  onNext: (questionId?: string, value?: any) => Promise<void>;
  onBack: () => void;
  onJumpToQuestion: (index: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  isEvaluating: boolean;
  onSwitchToClassic: () => void;
  uploadFile: (file: File) => Promise<void>;
  uploadBusy: boolean;
  FieldInputComponent: React.ComponentType<any>;
  isComplete: boolean;
}

// ─────────────────────────────────────────────
// Helpers: question → conversational prompt
// ─────────────────────────────────────────────
function questionToConversational(
  question: any,
  name: string,
  isFirst: boolean,
  prevAnswer?: { q: string; a: string },
  lang: string = "en"
): string {
  const title = (question.title || question.label || "").trim();
  const type = question.type;
  const options: string[] = Array.isArray(question.options)
    ? question.options
    : Array.isArray(question.settings?.options)
    ? question.settings.options : [];

  const isHindi = lang === "hi" || ["bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "od"].includes(lang);

  if (isHindi && lang === "hi") {
    let prefix = "";
    if (isFirst && name) prefix = `धन्यवाद ${name} जी! `;
    switch (type) {
      case "rating":
        return `${prefix}${title} — कृपया 1 से 5 के बीच में रेटिंग दें।`;
      case "nps":
        return `${prefix}${title} — 0 से 10 के बीच में स्कोर दें।`;
      case "opinion_scale": {
        const min = question.settings?.min ?? 1;
        const max = question.settings?.max ?? 5;
        return `${prefix}${title} — ${min} से ${max} के पैमाने पर बताएं।`;
      }
      case "yes_no":
        return `${prefix}${title} — हाँ या ना में बताएं।`;
      case "single_choice":
      case "dropdown":
      case "image_choice":
        return options.length <= 5
          ? `${prefix}${title} आपके विकल्प हैं: ${options.join(", ")}।`
          : `${prefix}${title}`;
      case "multiple_choice":
        return `${prefix}${title} आप एक या अधिक विकल्प चुन सकते हैं: ${options.join(", ")}।`;
      case "email":
        return `${prefix}आपका ईमेल पता क्या है?`;
      case "phone":
        return `${prefix}आपका फ़ोन नंबर क्या है?`;
      case "name":
        return `${prefix}कृपया अपना पूरा नाम बताएं।`;
      case "address":
        return `${prefix}आपका पता क्या है?`;
      case "long_text":
        return `${prefix}${title} कृपया विस्तार से बताएं।`;
      default:
        return `${prefix}${title}`;
    }
  }

  // Personalised prefix
  let prefix = "";
  if (isFirst && name) prefix = `Alright ${name}! `;
  else if (prevAnswer && prevAnswer.a) {
    const contextPrefixes = [
      `Got it — you said "${prevAnswer.a}". `,
      `Noted that! `,
      `That's helpful, thanks! `,
      `Appreciate that. `,
    ];
    prefix = contextPrefixes[Math.abs(title.length) % contextPrefixes.length];
  }

  switch (type) {
    case "rating":
      return `${prefix}${title} — just say a number from 1 to 5, or tap a star below.`;
    case "nps":
      return `${prefix}${title} Give me a score from 0 to 10.`;
    case "opinion_scale": {
      const min = question.settings?.min ?? 1;
      const max = question.settings?.max ?? 5;
      return `${prefix}${title} On a scale of ${min} to ${max}.`;
    }
    case "yes_no":
      return `${prefix}${title} Just say yes or no, or tap below.`;
    case "single_choice":
    case "dropdown":
    case "image_choice":
      return options.length <= 5
        ? `${prefix}${title} Your choices are: ${options.join(", ")}.`
        : `${prefix}${title}`;
    case "multiple_choice":
      return `${prefix}${title} You can pick one or more — options are: ${options.join(", ")}.`;
    case "checkbox":
      return `${prefix}${title} Say "I agree" or tap to confirm.`;
    case "email":
      return `${prefix}What email address should I reach you at?`;
    case "phone":
      return `${prefix}What's the best phone number for you?`;
    case "name":
      return `${prefix}Could you tell me your full name?`;
    case "address":
      return `${prefix}What's your address?`;
    case "date":
    case "date_time":
    case "scheduling":
      return `${prefix}${title} Please share the date.`;
    case "long_text":
      return `${prefix}${title} Take your time — speak freely or type below.`;
    default:
      return `${prefix}${title}`;
  }
}

function buildGreeting(name: string, formTitle: string): string {
  const n = name ? `, ${name}` : "";
  return `Hey${n}! 👋 I'm here to help you with "${formTitle}". Think of this as a quick chat — I'll guide you through a few things. Ready whenever you are!`;
}

function buildAcknowledgment(answer: string, questionIndex: number, isLast: boolean, t?: any): string {
  if (t?.transitions && t.transitions.length) {
    const phrase = t.transitions[questionIndex % t.transitions.length];
    if (isLast) {
      return `${answer ? `"${answer}" — ` : ""}${phrase} ${t.thankYouDefault || ""}`;
    }
    return `${answer ? `"${answer}" — ` : ""}${phrase}`;
  }
  const phrases = [
    `${answer ? `"${answer}" — ` : ""}perfect, got it!`,
    `Got that${answer ? ` — "${answer}"` : ""}. `,
    `Thanks for sharing that!`,
    `Wonderful, noted!`,
    `Great, that's helpful!`,
    `Understood, moving on!`,
    `Appreciate that!`,
    `Excellent choice!`,
  ];
  const phrase = phrases[questionIndex % phrases.length];
  if (isLast) {
    return `${phrase} That was everything! Let me wrap this up now.`;
  }
  return phrase;
}

function formatAnswerDisplay(question: any, value: any): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes ✓" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && value.name) return `📎 ${value.name}`;
  return String(value);
}

// ─────────────────────────────────────────────
// Language-Aware SpeechSynthesis helper
// ─────────────────────────────────────────────
function speak(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  muted = false,
  lang = "en-US"
): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onStart?.();
    setTimeout(() => onEnd?.(), 100);
    return;
  }
  window.speechSynthesis.cancel();
  if (muted) {
    onStart?.();
    setTimeout(() => onEnd?.(), 150);
    return;
  }

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  utter.rate = 0.96;
  utter.pitch = 1.02;

  // Language matching: 1. Exact locale (e.g. es-ES), 2. Base language prefix (e.g. es), 3. First voice
  const voices = window.speechSynthesis.getVoices();
  const baseLang = lang.split("-")[0].toLowerCase();
  const preferred =
    voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find(v => v.lang.toLowerCase().startsWith(baseLang)) ||
    voices[0];
  if (preferred) utter.voice = preferred;

  utter.onstart = () => onStart?.();
  utter.onend = () => onEnd?.();
  utter.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utter);
}

// ─────────────────────────────────────────────
// Unified speak helper: Sarvam TTS → fallback Web Speech
// ─────────────────────────────────────────────
let activeSarvamAudio: HTMLAudioElement | null = null;
let sarvamPlayId = 0;

async function speakViaSarvam(
  text: string,
  ttsM: { mutateAsync: (input: { text: string; language: string }) => Promise<{ audioBase64: string }> },
  lang: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<boolean> {
  const currentPlayId = ++sarvamPlayId;
  try {
    const res = await ttsM.mutateAsync({ text, language: lang });
    if (currentPlayId !== sarvamPlayId) return false;
    const parts = res.audioBase64.split("|");
    onStart?.();
    for (const b64 of parts) {
      if (currentPlayId !== sarvamPlayId) break;
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/mp3" });
      const url = URL.createObjectURL(blob);
      await new Promise<void>((resolve) => {
        if (currentPlayId !== sarvamPlayId) {
          URL.revokeObjectURL(url);
          resolve();
          return;
        }
        const audio = new Audio(url);
        activeSarvamAudio = audio;
        const cleanup = () => {
          URL.revokeObjectURL(url);
          if (activeSarvamAudio === audio) activeSarvamAudio = null;
          resolve();
        };
        audio.onended = cleanup;
        audio.onerror = cleanup;
        audio.play().catch(() => cleanup());
      });
    }
    if (currentPlayId === sarvamPlayId) {
      onEnd?.();
      return true;
    }
    return false;
  } catch (err) {
    console.debug("[CoForms Voice] Sarvam TTS unavailable, using browser speech synthesis fallback:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// ─────────────────────────────────────────────
// SpeechRecognition & audio cancellation helper
// ─────────────────────────────────────────────
function stopSpeaking() {
  sarvamPlayId++;
  if (activeSarvamAudio) {
    try {
      activeSarvamAudio.pause();
      activeSarvamAudio.currentTime = 0;
    } catch {
      // ignore
    }
    activeSarvamAudio = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function getRecognition(): any {
  if (typeof window === "undefined") return null;
  const W = window as any;
  const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!SR) return null;
  return new SR();
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export function InteractiveVoiceAgent({
  slug, responseId, progressToken,
  form, questions, visible, answers, onAnswerChange,
  currentIndex, onNext, onBack, onJumpToQuestion, onSubmit,
  isSubmitting, isEvaluating, onSwitchToClassic,
  uploadFile, uploadBusy, FieldInputComponent, isComplete,
}: InteractiveVoiceAgentProps) {

  const turnMutation = trpc.forms.interviewTurn.useMutation();
  const ttsM = trpc.forms.sarvamTTS.useMutation();
  const sttM = trpc.forms.sarvamSTT.useMutation();

  // Welcome state
  const [stage, setStage] = useState<"welcome" | "conversation">("welcome");
  const [respondentName, setRespondentName] = useState("");
  const [respondentEmail, setRespondentEmail] = useState("");
  const [selectedLang, setSelectedLang] = useState<LanguageCode>("en");
  const [interviewMode, setInterviewMode] = useState<InterviewMode>("voice");

  // Conversation state
  const [agentState, setAgentState] = useState<AgentState>("greeting");
  const [currentSpeech, setCurrentSpeech] = useState("");
  const [isFading, setIsFading] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [micAvailable, setMicAvailable] = useState(true);
  const [isListeningActive, setIsListeningActive] = useState(false);
  const [lastAnswerDisplay, setLastAnswerDisplay] = useState("");

  const recognitionRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const hasGreeted = useRef(false);
  const micPermissionDeniedRef = useRef(false);
  const currentRequestIdRef = useRef(0);
  const speechTimerRef = useRef<any>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<any>(null);
  const isSarvamRecordingRef = useRef(false);

  const t = TRANSLATIONS[selectedLang] || TRANSLATIONS.en;
  const currentLocale = BROWSER_LOCALE_MAP[selectedLang] || "en-US";
  const useSarvamTTS = SARVAM_TTS_LANGS.has(selectedLang);
  // Ref to latest mutations so callbacks don't capture stale versions
  const ttsMRef = useRef(ttsM);
  useEffect(() => { ttsMRef.current = ttsM; }, [ttsM]);
  const sttMRef = useRef(sttM);
  useEffect(() => { sttMRef.current = sttM; }, [sttM]);
  const handleUserSpokenInputRef = useRef<(spoken: string) => void>(() => {});
  const startListeningRef = useRef<() => void>(() => {});
  // per-request ID to guard stale turn responses (replaces isPending guard for input drops)
  const processingRef = useRef(false);

  const currentQuestion = visible[currentIndex];
  const isLastQuestion = currentIndex >= visible.length - 1;
  const currentOptions: string[] = useMemo(() => {
    if (!currentQuestion) return [];
    return Array.isArray(currentQuestion.options)
      ? currentQuestion.options
      : Array.isArray(currentQuestion.settings?.options)
      ? currentQuestion.settings.options : [];
  }, [currentQuestion]);

  // Check mic availability on mount
  useEffect(() => {
    const hasRec = !!getRecognition();
    setMicAvailable(hasRec);
    if (!hasRec) {
      setInterviewMode("text");
    }
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, interimTranscript]);

  // ──────────────────────────────────
  // Voice Recognition Controls
  // ──────────────────────────────────
  const stopListening = useCallback(() => {
    isSarvamRecordingRef.current = false;
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }
    setIsListeningActive(false);
    setInterimTranscript("");
  }, []);

  // ──────────────────────────────────
  // Immediate Barge-in / Interruption
  // ──────────────────────────────────
  const interruptSpeaking = useCallback((_reason?: string) => {
    stopSpeaking();
    processingRef.current = false;
    currentRequestIdRef.current++;
    if (speechTimerRef.current) {
      clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    setInterimTranscript("");

    if (interviewMode === "voice" && micAvailable && !micPermissionDeniedRef.current) {
      setAgentState("listening");
      // Start listening directly
      if (typeof window !== "undefined") {
        const rec = getRecognition();
        if (rec) {
          recognitionRef.current = rec;
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = currentLocale;

          rec.onstart = () => {
            setIsListeningActive(true);
            setAgentState("listening");
          };

          rec.onresult = (e: any) => {
            let interim = "";
            let finalChunk = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const text = e.results[i][0].transcript;
              if (e.results[i].isFinal) {
                finalChunk += text;
              } else {
                interim += text;
              }
            }

            if (interim) {
              stopSpeaking();
              setInterimTranscript(interim);
            }

            if (finalChunk.trim()) {
              setInterimTranscript("");
              handleUserSpokenInput(finalChunk.trim());
            }
          };

          rec.onerror = (e: any) => {
            if (e.error === "not-allowed" || e.error === "permission-denied") {
              micPermissionDeniedRef.current = true;
              setMicAvailable(false);
              setInterviewMode("text");
              toast.error(t.micDeniedError);
            }
            setIsListeningActive(false);
            setInterimTranscript("");
          };

          rec.onend = () => {
            setIsListeningActive(false);
          };

          try {
            rec.start();
          } catch {
            // Already listening
          }
        }
      }
    } else {
      setAgentState("listening");
    }
  }, [interviewMode, micAvailable, currentLocale, t]);

  // Spacebar and Escape keyboard listener
  useEffect(() => {
    if (stage !== "conversation") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.code === "Space" && !isInput) {
        e.preventDefault();
        interruptSpeaking("spacebar");
      }
      if (e.key === "Escape") {
        setIsMuted(m => !m);
        stopSpeaking();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [stage, interruptSpeaking]);

  // Clean stop on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
      stopListening();
      if (speechTimerRef.current) clearTimeout(speechTimerRef.current);
    };
  }, [stopListening]);

  // ──────────────────────────────────
  // Core: Say something & trigger next state
  // ──────────────────────────────────
  const sayAndThen = useCallback((text: string, then: () => void) => {
    setIsFading(true);
    speechTimerRef.current = setTimeout(() => {
      setCurrentSpeech(text);
      setIsFading(false);
      setAgentState("asking");
      setTranscript(prev => [...prev, { role: "ai", text }]);
      if (isMuted || interviewMode === "text") {
        setTimeout(() => then(), 150);
        return;
      }
      if (useSarvamTTS) {
        speakViaSarvam(text, ttsMRef.current, selectedLang, undefined, then)
          .then(ok => { if (!ok) speak(text, undefined, then, false, currentLocale); })
          .catch(() => speak(text, undefined, then, false, currentLocale));
      } else {
        speak(text, undefined, then, false, currentLocale);
      }
    }, 250);
  }, [isMuted, interviewMode, currentLocale, useSarvamTTS, selectedLang]);

  // ──────────────────────────────────
  // Voice Recognition (MediaRecorder + Sarvam STT with Web Speech fallback)
  // ──────────────────────────────────
  const startListening = useCallback(async () => {
    if (!micAvailable || micPermissionDeniedRef.current) {
      if (!micAvailable) toast.info(t.micUnsupportedError);
      return;
    }
    stopSpeaking();
    stopListening();

    const isSarvamLang = SARVAM_TTS_LANGS.has(selectedLang);

    // If it's a Sarvam language and getUserMedia is supported, use MediaRecorder + Sarvam STT
    if (isSarvamLang && typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        audioChunksRef.current = [];
        isSarvamRecordingRef.current = true;

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          setIsListeningActive(false);
          const chunks = audioChunksRef.current;
          audioChunksRef.current = [];
          if (!chunks.length) return;
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          if (blob.size < 600) return; // Too short to contain speech

          // Convert Blob to Base64
          const reader = new FileReader();
          reader.onloadend = async () => {
            const dataUrl = reader.result as string;
            const base64Audio = dataUrl.split(",")[1];
            if (!base64Audio) return;

            setAgentState("processing");
            try {
              const res = await sttMRef.current.mutateAsync({
                audioBase64: base64Audio,
                mimeType: blob.type || "audio/webm",
                language: selectedLang,
              });
              if (res.transcript && res.transcript.trim()) {
                handleUserSpokenInputRef.current(res.transcript.trim());
              } else {
                setAgentState("listening");
                startListeningRef.current();
              }
            } catch (err) {
              console.debug("[CoForms Voice] Sarvam STT unavailable, using fallback:", err);
              setAgentState("listening");
              startListeningRef.current();
            }
          };
          reader.readAsDataURL(blob);
        };

        recorder.start(250);
        setIsListeningActive(true);
        setAgentState("listening");

        // Voice activity & silence detector
        try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioCtx) {
            const audioCtx = new AudioCtx();
            audioContextRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);

            let spoke = false;
            let silenceStart = 0;
            vadIntervalRef.current = setInterval(() => {
              if (!isSarvamRecordingRef.current) return;
              analyser.getByteFrequencyData(data);
              let total = 0;
              for (let i = 0; i < data.length; i++) total += data[i];
              const avg = total / data.length;

              if (avg > 14) {
                spoke = true;
                silenceStart = 0;
              } else if (spoke) {
                if (!silenceStart) silenceStart = Date.now();
                else if (Date.now() - silenceStart > 1600) {
                  // User has paused speaking — finalize answer
                  isSarvamRecordingRef.current = false;
                  clearInterval(vadIntervalRef.current);
                  vadIntervalRef.current = null;
                  if (recorder.state === "recording") {
                    recorder.stop();
                  }
                  if (mediaStreamRef.current) {
                    mediaStreamRef.current.getTracks().forEach(t => t.stop());
                    mediaStreamRef.current = null;
                  }
                }
              }
            }, 100);
          }
        } catch {
          // ignore VAD setup failure
        }

        // Run browser SpeechRecognition in parallel if available ONLY for interim transcript display
        const rec = getRecognition();
        if (rec) {
          recognitionRef.current = rec;
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = currentLocale;
          rec.onresult = (e: any) => {
            let interim = "";
            for (let i = e.resultIndex; i < e.results.length; i++) {
              if (!e.results[i].isFinal) interim += e.results[i][0].transcript;
            }
            if (interim) {
              stopSpeaking();
              setInterimTranscript(interim);
            }
          };
          rec.onerror = () => {};
          try { rec.start(); } catch {}
        }
        return;
      } catch (err: any) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          micPermissionDeniedRef.current = true;
          setMicAvailable(false);
          setInterviewMode("text");
          toast.error(t.micDeniedError);
          return;
        }
        // Fall through to browser SpeechRecognition below
      }
    }

    // Standard Web Speech API fallback
    const rec = getRecognition();
    if (!rec) return;

    recognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = currentLocale;

    rec.onstart = () => {
      setIsListeningActive(true);
      setAgentState("listening");
    };

    rec.onresult = (e: any) => {
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalChunk += text;
        } else {
          interim += text;
        }
      }

      if (interim) {
        stopSpeaking();
        setInterimTranscript(interim);
      }

      if (finalChunk.trim()) {
        setInterimTranscript("");
        handleUserSpokenInputRef.current(finalChunk.trim());
      }
    };

    rec.onerror = (e: any) => {
      setIsListeningActive(false);
      setInterimTranscript("");
      if (e.error === "not-allowed" || e.error === "permission-denied") {
        micPermissionDeniedRef.current = true;
        setMicAvailable(false);
        setInterviewMode("text");
        toast.error(t.micDeniedError);
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        toast.error("Mic: " + e.error);
      }
    };

    rec.onend = () => {
      setIsListeningActive(false);
    };

    try {
      rec.start();
    } catch {
      // already active
    }
  }, [micAvailable, currentLocale, t, selectedLang, stopListening]);

  // ──────────────────────────────────
  // Ask current question
  // ──────────────────────────────────
  const askCurrentQuestion = useCallback(() => {
    if (!currentQuestion) return;
    const prevQ = visible[currentIndex - 1];
    const prevAns = prevQ ? formatAnswerDisplay(prevQ, answers[prevQ.id]) : "";
    const prompt = questionToConversational(
      currentQuestion,
      respondentName,
      currentIndex === 0,
      prevAns ? { q: prevQ?.title || "", a: prevAns } : undefined,
      selectedLang
    );

    sayAndThen(prompt, () => {
      // After asking, start listening automatically in voice mode for voice-friendly questions
      const voiceFriendly = [
        "short_text", "long_text", "email", "phone", "number", "url",
        "name", "address", "yes_no", "rating", "opinion_scale", "nps",
        "single_choice", "dropdown"
      ].includes(currentQuestion.type);
      if (interviewMode === "voice" && voiceFriendly && micAvailable && !micPermissionDeniedRef.current) {
        // Small delay to let browser audio pipeline clear before re-opening mic
        speechTimerRef.current = setTimeout(() => {
          processingRef.current = false;
          startListening();
        }, 600);
      } else {
        processingRef.current = false;
        setAgentState("listening");
      }
    });
  }, [currentQuestion, currentIndex, visible, answers, respondentName, interviewMode, micAvailable, sayAndThen, startListening, selectedLang]);

  // ──────────────────────────────────
  // Greeting → then first question
  // ──────────────────────────────────
  const startConversation = useCallback(() => {
    if (hasGreeted.current) return;
    hasGreeted.current = true;
    const greeting = t.greeting ? t.greeting(respondentName, form.title || "this survey") : buildGreeting(respondentName, form.title || "this survey");
    setCurrentSpeech(greeting);
    setTranscript([{ role: "ai", text: greeting }]);
    setAgentState("greeting");
    if (isMuted || interviewMode === "text") {
      speechTimerRef.current = setTimeout(() => askCurrentQuestion(), 500);
    } else if (useSarvamTTS) {
      speakViaSarvam(greeting, ttsMRef.current, selectedLang, undefined, () => {
        speechTimerRef.current = setTimeout(() => askCurrentQuestion(), 500);
      }).then(ok => {
        if (!ok) speak(greeting, undefined, () => {
          speechTimerRef.current = setTimeout(() => askCurrentQuestion(), 500);
        }, false, currentLocale);
      });
    } else {
      speak(greeting, undefined, () => {
        speechTimerRef.current = setTimeout(() => askCurrentQuestion(), 500);
      }, false, currentLocale);
    }
  }, [respondentName, form.title, isMuted, interviewMode, currentLocale, useSarvamTTS, selectedLang, askCurrentQuestion, t]);

  // Auto-start conversation when stage changes to "conversation"
  useEffect(() => {
    if (stage === "conversation") {
      speechTimerRef.current = setTimeout(() => startConversation(), 300);
    }
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-ask when question index changes
  const prevIndexRef = useRef(currentIndex);
  useEffect(() => {
    if (stage !== "conversation" || !hasGreeted.current) return;
    if (currentIndex !== prevIndexRef.current) {
      prevIndexRef.current = currentIndex;
      speechTimerRef.current = setTimeout(() => askCurrentQuestion(), 300);
    }
  }, [currentIndex, stage, askCurrentQuestion]);

  // ──────────────────────────────────
  // Acknowledge answer + advance
  // ──────────────────────────────────
  const confirmAndAdvance = useCallback((displayVal: string, customAck?: string, isAllComplete?: boolean, questionId?: string, value?: any) => {
    const ack = customAck || buildAcknowledgment(displayVal, currentIndex, isLastQuestion, t);
    setAgentState("acknowledged");
    setCurrentSpeech(ack);
    setTranscript(prev => [...prev, { role: "ai", text: ack }]);

    const afterAck = async () => {
      if (isAllComplete || isLastQuestion) {
        setAgentState("complete");
        onSubmit();
      } else {
        await onNext(questionId, value);
        // onNext() is async and changes currentIndex — wait a tick for React to re-render,
        // then askCurrentQuestion will fire from the prevIndexRef effect.
      }
    };

    if (isMuted || interviewMode === "text") {
      afterAck();
    } else if (useSarvamTTS) {
      speakViaSarvam(ack, ttsMRef.current, selectedLang, undefined, () => afterAck())
        .then(ok => { if (!ok) speak(ack, undefined, () => afterAck(), false, currentLocale); })
        .catch(() => afterAck());
    } else {
      speak(ack, undefined, () => afterAck(), false, currentLocale);
    }
  }, [currentIndex, isLastQuestion, isMuted, interviewMode, currentLocale, useSarvamTTS, selectedLang, onNext, onSubmit]);

  // ──────────────────────────────────
  // Deterministic local fallback
  // ──────────────────────────────────
  const fallbackClientProcessing = useCallback((text: string) => {
    if (!currentQuestion) return;
    const parsed = parseSpokenAnswer(
      { id: currentQuestion.id, type: currentQuestion.type, title: currentQuestion.title, options: currentOptions, settings: currentQuestion.settings },
      text,
      currentOptions
    );

    const displayText = parsed?.display || text;
    setLastAnswerDisplay(displayText);

    if (parsed && !parsed.isAmbiguous) {
      onAnswerChange(currentQuestion.id, parsed.value);
      confirmAndAdvance(displayText, undefined, undefined, currentQuestion.id, parsed.value);
    } else {
      processingRef.current = false;
      const clarify = parsed?.message
        ? `Hmm, I want to make sure I get this right — ${parsed.message} Could you try again?`
        : t.clarificationPrompt;
      sayAndThen(clarify, () => {
        if (interviewMode === "voice" && micAvailable && !micPermissionDeniedRef.current) {
          startListening();
        }
      });
    }
  }, [currentQuestion, currentOptions, onAnswerChange, confirmAndAdvance, sayAndThen, t, interviewMode, micAvailable, startListening]);

  // ──────────────────────────────────
  // Process user input (voice or typed)
  // ──────────────────────────────────
  const handleUserSpokenInput = useCallback((spoken: string) => {
    const text = spoken.trim();
    if (!currentQuestion || !text) return;
    // Use a local flag instead of turnMutation.isPending so a new utterance after
    // interruption is never silently dropped by a stale pending-mutation guard.
    if (processingRef.current) return;
    processingRef.current = true;
    stopListening();
    setInterimTranscript("");
    setAgentState("processing");

    const requestId = ++currentRequestIdRef.current;
    // Add user response to ephemeral in-memory transcript (not persisted to DB)
    setTranscript(prev => [...prev, { role: "user", text }]);

    if (slug && responseId && progressToken) {
      turnMutation.mutate({
        slug,
        responseId,
        progressToken,
        utterance: text,
        currentAnswers: answers,
        language: selectedLang,
      }, {
        onSuccess: (res) => {
          // Guard against stale response overwriting user state after an interruption
          if (requestId !== currentRequestIdRef.current) {
            processingRef.current = false;
            return;
          }

          if (res.proposedAnswer && !res.clarificationNeeded) {
            onAnswerChange(res.proposedAnswer.questionId, res.proposedAnswer.value);
            setLastAnswerDisplay(res.proposedAnswer.displayValue);
            // processingRef is reset inside askCurrentQuestion (after onNext)
            confirmAndAdvance(res.proposedAnswer.displayValue, res.assistantMessage, res.isComplete, res.proposedAnswer.questionId, res.proposedAnswer.value);
          } else {
            processingRef.current = false;
            const msg = res.assistantMessage || t.clarificationPrompt;
            setCurrentSpeech(msg);
            setTranscript(prev => [...prev, { role: "ai", text: msg }]);
            sayAndThen(msg, () => {
              if (interviewMode === "voice" && micAvailable && !isMuted && !micPermissionDeniedRef.current) {
                startListening();
              }
            });
          }
        },
        onError: () => {
          processingRef.current = false;
          if (requestId !== currentRequestIdRef.current) return;
          fallbackClientProcessing(text);
        }
      });
    } else {
      processingRef.current = false;
      fallbackClientProcessing(text);
    }
  }, [currentQuestion, turnMutation, slug, responseId, progressToken, answers, selectedLang, stopListening, onAnswerChange, confirmAndAdvance, sayAndThen, interviewMode, micAvailable, isMuted, startListening, fallbackClientProcessing, t]);

  useEffect(() => {
    handleUserSpokenInputRef.current = handleUserSpokenInput;
  }, [handleUserSpokenInput]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const handleTextSubmit = useCallback(() => {
    const input = textInput.trim();
    if (!input || !currentQuestion || turnMutation.isPending) return;
    setTextInput("");
    handleUserSpokenInput(input);
  }, [textInput, currentQuestion, turnMutation.isPending, handleUserSpokenInput]);

  // ──────────────────────────────────
  // Welcome form submit
  // ──────────────────────────────────
  const handleWelcomeStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (respondentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(respondentEmail)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    // Auto-fill matching form questions
    if (respondentName) {
      const nameQ = questions.find(q => q.type === "name" || q.title?.toLowerCase().includes("name"));
      if (nameQ && !answers[nameQ.id]) onAnswerChange(nameQ.id, respondentName);
    }
    if (respondentEmail) {
      const emailQ = questions.find(q => q.type === "email" || q.title?.toLowerCase().includes("email"));
      if (emailQ && !answers[emailQ.id]) onAnswerChange(emailQ.id, respondentEmail);
    }
    setStage("conversation");
  };

  // ──────────────────────────────────
  // Interactive widget for choices, ratings, etc.
  // ──────────────────────────────────
  const handleWidgetSelect = useCallback((value: any, display: string) => {
    if (!currentQuestion) return;
    onAnswerChange(currentQuestion.id, value);
    stopListening();
    setLastAnswerDisplay(display);
    setTranscript(prev => [...prev, { role: "user", text: display }]);
    confirmAndAdvance(display, undefined, undefined, currentQuestion.id, value);
  }, [currentQuestion, onAnswerChange, stopListening, confirmAndAdvance]);

  // ──────────────────────────────────
  // RENDER: Complete screen
  // ──────────────────────────────────
  if (isComplete) {
    return (
      <div className="sva-shell">
        <div className="sva-complete">
          <div className="sva-complete-orb"><Check size={40} /></div>
          <h1 className="sva-complete-title">{form.settings?.thankYouText || t.thankYouDefault}</h1>
          <p className="sva-complete-sub">{t.responseRecorded}</p>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────
  // RENDER: Welcome screen
  // ──────────────────────────────────
  if (stage === "welcome") {
    return (
      <div className="sva-shell">
        <div className="sva-welcome">
          <div className="sva-welcome-orb-preview" />
          <div className="sva-welcome-badge">
            <Sparkles size={11} />
            <span>{t.badge}</span>
            {useSarvamTTS && (
              <span style={{ marginLeft: 6, fontSize: "0.72rem", background: "rgba(242, 200, 75, 0.22)", color: "#f2c84b", padding: "1px 6px", borderRadius: 4, fontWeight: 700, letterSpacing: "0.03em" }}>
                ⚡ Powered by Sarvam AI
              </span>
            )}
          </div>
          <h1 className="sva-welcome-title">{form.title || "Survey"}</h1>
          <p className="sva-welcome-desc">
            {form.description || t.welcomeSubtitle}
          </p>

          <form onSubmit={handleWelcomeStart} className="sva-welcome-fields">
            {/* Mode Selection Cards */}
            <label className="sva-mode-label">{t.modeTitle}</label>
            <div className="sva-mode-group" role="radiogroup" aria-label={t.modeTitle}>
              <button
                type="button"
                className={`sva-mode-card ${interviewMode === "voice" ? "active" : ""}`}
                onClick={() => {
                  if (!micAvailable) {
                    toast.info(t.micUnsupportedError);
                    return;
                  }
                  setInterviewMode("voice");
                }}
                role="radio"
                aria-checked={interviewMode === "voice"}
                disabled={!micAvailable}
              >
                <div className="sva-mode-card-header">
                  <Mic size={15} />
                  <span>{t.modeVoiceTitle}</span>
                  {useSarvamTTS && (
                    <span style={{ marginLeft: "auto", fontSize: "0.68rem", background: "rgba(242, 200, 75, 0.2)", color: "#f2c84b", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                      Sarvam Bulbul & Saaras
                    </span>
                  )}
                </div>
                <p className="sva-mode-card-desc">
                  {useSarvamTTS
                    ? "Natural Indian voice by Sarvam Bulbul (Priya) with hands-free Saaras voice recognition."
                    : t.modeVoiceDesc}
                </p>
              </button>

              <button
                type="button"
                className={`sva-mode-card ${interviewMode === "text" ? "active" : ""}`}
                onClick={() => setInterviewMode("text")}
                role="radio"
                aria-checked={interviewMode === "text"}
              >
                <div className="sva-mode-card-header">
                  <MessageSquare size={15} />
                  <span>{t.modeTextTitle}</span>
                </div>
                <p className="sva-mode-card-desc">{t.modeTextDesc}</p>
              </button>
            </div>

            {/* Language */}
            <div className="sva-field-row" style={{ marginTop: 8 }}>
              <Globe size={16} />
              <select className="sva-lang-select" value={selectedLang}
                onChange={e => setSelectedLang(e.target.value as LanguageCode)}
                aria-label="Select language">
                {SUPPORTED_LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {l.native} {l.engine ? `(${l.engine})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Name */}
            <div className="sva-field-row">
              <User size={16} />
              <input
                type="text"
                className="sva-field-input"
                placeholder={t.namePlaceholder}
                value={respondentName}
                onChange={e => setRespondentName(e.target.value)}
                autoComplete="name"
              />
            </div>

            {/* Email */}
            <div className="sva-field-row">
              <Mail size={16} />
              <input
                type="email"
                className="sva-field-input"
                placeholder={t.emailPlaceholder}
                value={respondentEmail}
                onChange={e => setRespondentEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <button type="submit" className="sva-start-btn" id="sva-start-btn">
              <Sparkles size={15} /> {t.startInterview} <span style={{ fontSize: 18 }}>→</span>
            </button>
          </form>

          <button className="sva-classic-link" onClick={onSwitchToClassic} type="button">
            {t.switchToClassic} →
          </button>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────
  // RENDER: Active conversation
  // ──────────────────────────────────
  const isAiSpeaking = agentState === "greeting" || agentState === "asking" || agentState === "acknowledged";
  const orbClass = isListeningActive
    ? "listening"
    : agentState === "processing"
    ? "processing"
    : isAiSpeaking
    ? "speaking"
    : "idle";

  const showWidget = currentQuestion && agentState === "listening" &&
    ["single_choice", "yes_no", "image_choice", "rating", "opinion_scale", "nps", "multiple_choice"].includes(currentQuestion.type);

  return (
    <div className="sva-shell">
      {/* Top bar */}
      <header className="sva-topbar">
        <div className="sva-topbar-left">
          <div className="sva-topbar-badge">
            <Sparkles size={11} />
            <span>{t.badge}</span>
            {useSarvamTTS && (
              <span style={{ marginLeft: 6, fontSize: "0.68rem", background: "rgba(242, 200, 75, 0.2)", color: "#f2c84b", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>
                ⚡ Sarvam AI Voice
              </span>
            )}
          </div>
          <span className="sva-form-title">{form.title}</span>
        </div>
        <div className="sva-topbar-right">
          {/* Mode toggle */}
          <button
            type="button"
            className="sva-mode-pill"
            onClick={() => {
              if (interviewMode === "voice") {
                setInterviewMode("text");
                stopSpeaking();
                stopListening();
                toast.info(t.switchedToTextMode);
              } else {
                if (!micAvailable || micPermissionDeniedRef.current) {
                  toast.info(t.micUnsupportedError);
                  return;
                }
                setInterviewMode("voice");
                toast.success(t.modeVoiceTitle);
              }
            }}
            title="Toggle Voice / Text Mode"
          >
            {interviewMode === "voice" ? <Mic size={13} /> : <MessageSquare size={13} />}
            <span>{interviewMode === "voice" ? "Voice" : "Text"}</span>
          </button>

          {/* Mute toggle */}
          <button
            type="button"
            className="sva-mute-btn"
            onClick={() => {
              setIsMuted(m => !m);
              stopSpeaking();
            }}
            title={isMuted ? "Unmute AI" : "Mute AI"}
          >
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>

          {/* Switch to classic */}
          <button type="button" className="sva-classic-btn-top" onClick={onSwitchToClassic}>
            <FileText size={13} /> {t.switchToClassic}
          </button>
        </div>
      </header>

      {/* Conversation stage */}
      <div className="sva-stage">
        {/* The Orb */}
        <div className="sva-orb-wrap">
          {isListeningActive && (
            <>
              <div className="sva-orb-ring" />
              <div className="sva-orb-ring" />
              <div className="sva-orb-ring" />
            </>
          )}
          <div className={`sva-orb ${orbClass}`} role="img" aria-label={`AI is ${orbClass}`} />
          {isAiSpeaking && (
            <div className="sva-wave-bars">
              {[1,2,3,4,5,6,7].map(i => <div key={i} className="sva-wave-bar" />)}
            </div>
          )}
        </div>

        {/* Agent status label */}
        <div className={`sva-ai-status-label ${orbClass}`}>
          {isListeningActive ? (
            <><Mic size={12} /> {t.listeningState}</>
          ) : agentState === "processing" ? (
            <><LoaderCircle size={12} style={{ animation: "spin 1s linear infinite" }} /> Thinking…</>
          ) : isAiSpeaking ? (
            <><Volume2 size={12} /> {t.speakingState}</>
          ) : (
            <><Bot size={12} /> Ready</>
          )}
        </div>

        {/* Current AI speech */}
        <div className="sva-ai-message">
          {agentState === "processing" && !currentSpeech ? (
            <div className="sva-typing-dots">
              <div className="sva-typing-dot" />
              <div className="sva-typing-dot" />
              <div className="sva-typing-dot" />
            </div>
          ) : (
            <p className={`sva-ai-text ${isFading ? "fading" : ""}`}>{currentSpeech}</p>
          )}
        </div>

        {/* Tactile Interrupt / Speak Button (Visible while AI is speaking) */}
        {isAiSpeaking && (
          <div className="sva-interrupt-bar">
            <button
              type="button"
              className="sva-interrupt-btn"
              onClick={() => interruptSpeaking("button_click")}
              aria-label={t.interruptBtn}
            >
              <Mic size={14} />
              <span>{t.interruptBtn}</span>
              <span className="sva-key-hint">Space</span>
            </button>
          </div>
        )}

        {/* Interim Speech Preview (Active while user speaks) */}
        {interimTranscript && (
          <div className="sva-interim-bubble" aria-live="polite">
            <span className="sva-interim-dot" />
            <span>{t.interimListening} <strong>"{interimTranscript}"</strong></span>
          </div>
        )}

        {/* Last user answer pill */}
        {lastAnswerDisplay && agentState !== "greeting" && (
          <div className="sva-last-answer">
            <span className="sva-last-answer-label">You said</span>
            <span>{lastAnswerDisplay}</span>
          </div>
        )}

        {/* Transcript history */}
        {transcript.length > 2 && (
          <div className="sva-transcript">
            {transcript.slice(0, -1).map((entry, i) => (
              <div key={i} className={`sva-transcript-item ${entry.role}`}>
                <span className="sva-transcript-role">{entry.role === "ai" ? "AI" : "You"}</span>
                <span className="sva-transcript-text">{entry.text}</span>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        )}

        {/* Interactive widget panel for choice / rating questions */}
        {showWidget && currentQuestion && (
          <WidgetPanel
            question={currentQuestion}
            options={currentOptions}
            value={answers[currentQuestion.id]}
            onSelect={handleWidgetSelect}
          />
        )}

        {/* File / complex inputs via existing FieldInput */}
        {currentQuestion && agentState === "listening" && ["file_upload", "signature", "matrix", "multiple_choice", "checkbox", "date", "date_time", "time", "scheduling", "payment"].includes(currentQuestion.type) && (
          <div className="sva-widget-panel">
            <div className="sva-widget-title"><Sparkles size={11} /> Select or input below</div>
            <FieldInputComponent
              question={currentQuestion}
              value={answers[currentQuestion.id]}
              onChange={(val: any) => {
                onAnswerChange(currentQuestion.id, val);
                const display = formatAnswerDisplay(currentQuestion, val);
                if (display) {
                  setLastAnswerDisplay(display);
                }
              }}
              onFile={uploadFile}
              disabled={isSubmitting || uploadBusy}
            />
            {answers[currentQuestion.id] !== undefined && (
              <button
                type="button"
                className="sva-send-btn"
                style={{ marginTop: 14, width: "100%", height: 44 }}
                onClick={() => {
                  const val = answers[currentQuestion.id];
                  const display = formatAnswerDisplay(currentQuestion, val);
                  setTranscript(prev => [...prev, { role: "user", text: display || "Submitted" }]);
                  confirmAndAdvance(display || "Done", undefined, undefined, currentQuestion.id, val);
                }}
              >
                <Send size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom: Mic + text input */}
      <div className="sva-bottom-panel">
        {/* Microphone Button (Only prominent in voice mode or when mic is enabled) */}
        <div className="sva-mic-wrap">
          {isListeningActive && (
            <>
              <div className="sva-mic-ripple" />
              <div className="sva-mic-ripple" />
              <div className="sva-mic-ripple" />
            </>
          )}
          <button
            type="button"
            className={`sva-mic-btn ${isListeningActive ? "active" : ""} ${!micAvailable || interviewMode === "text" ? "disabled" : ""}`}
            onClick={() => {
              if (!micAvailable || micPermissionDeniedRef.current) {
                toast.info(t.micUnsupportedError);
                return;
              }
              if (isListeningActive) {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                  mediaRecorderRef.current.stop();
                } else {
                  stopListening();
                }
              } else {
                if (isAiSpeaking) interruptSpeaking("mic_click");
                else startListening();
              }
            }}
            title={isListeningActive ? "Stop listening" : isAiSpeaking ? "Interrupt & Speak" : "Tap to speak"}
            aria-label={isListeningActive ? "Stop listening" : "Tap to speak"}
          >
            {isListeningActive ? <Mic size={26} /> : <MicOff size={24} />}
          </button>
        </div>

        <p className="sva-mic-hint">
          {interviewMode === "text"
            ? "Silent text chat mode — type below"
            : micAvailable
            ? isListeningActive
              ? t.listeningState
              : isAiSpeaking
              ? t.interruptHint
              : "Tap to speak — or type below"
            : t.micUnsupportedError}
        </p>

        {/* Text input row */}
        <div className="sva-text-input-row">
          <input
            type="text"
            className="sva-text-input"
            placeholder={agentState === "listening" ? t.typeAnswerPlaceholder : "Type something…"}
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleTextSubmit();
              }
            }}
            disabled={isSubmitting || isEvaluating}
          />
          <button
            type="button"
            className="sva-send-btn"
            onClick={handleTextSubmit}
            disabled={!textInput.trim() || isSubmitting}
            aria-label="Send answer"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// WidgetPanel — choice / rating / nps UI
// ─────────────────────────────────────────────
function WidgetPanel({ question, options, value, onSelect }: {
  question: any;
  options: string[];
  value: any;
  onSelect: (value: any, display: string) => void;
}) {
  if (question.type === "yes_no") {
    return (
      <div className="sva-widget-panel">
        <div className="sva-widget-title"><Sparkles size={11} /> Or tap to answer</div>
        <div className="sva-choice-grid">
          {["Yes", "No"].map(opt => (
            <button key={opt} type="button"
              className={`sva-choice-btn ${value === opt ? "active" : ""}`}
              onClick={() => onSelect(opt, opt)}
            >
              {opt === "Yes" ? "👍 Yes" : "👎 No"}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (question.type === "single_choice" || question.type === "image_choice") {
    return (
      <div className="sva-widget-panel">
        <div className="sva-widget-title"><Sparkles size={11} /> Or tap to pick</div>
        <div className="sva-choice-grid">
          {options.map(opt => (
            <button key={opt} type="button"
              className={`sva-choice-btn ${value === opt ? "active" : ""}`}
              onClick={() => onSelect(opt, opt)}
            >
              {value === opt && <Check size={13} />} {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (question.type === "multiple_choice") {
    const selected: string[] = Array.isArray(value) ? value : [];
    return (
      <div className="sva-widget-panel">
        <div className="sva-widget-title"><Sparkles size={11} /> Tap one or more</div>
        <div className="sva-choice-grid">
          {options.map(opt => {
            const active = selected.includes(opt);
            return (
              <button key={opt} type="button"
                className={`sva-choice-btn ${active ? "active" : ""}`}
                onClick={() => {
                  const next = active ? selected.filter(o => o !== opt) : [...selected, opt];
                  onSelect(next, next.join(", "));
                }}
              >
                {active && <Check size={13} />} {opt}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (question.type === "rating") {
    return (
      <div className="sva-widget-panel">
        <div className="sva-widget-title"><Sparkles size={11} /> Tap a star rating</div>
        <div className="sva-rating-row">
          {[1,2,3,4,5].map(n => (
            <button key={n} type="button"
              className={`sva-rating-btn ${Number(value) >= n ? "active" : ""}`}
              onClick={() => onSelect(n, `${n} star${n === 1 ? "" : "s"}`)}
            >
              ★
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (question.type === "opinion_scale" || question.type === "nps") {
    const min = question.type === "nps" ? 0 : (question.settings?.min ?? 1);
    const max = question.type === "nps" ? 10 : (question.settings?.max ?? 5);
    const items = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    return (
      <div className="sva-widget-panel">
        <div className="sva-widget-title"><Sparkles size={11} /> Tap a number</div>
        <div className="sva-rating-row" style={{ flexWrap: "wrap" }}>
          {items.map(n => (
            <button key={n} type="button"
              className={`sva-rating-btn ${Number(value) === n ? "active" : ""}`}
              onClick={() => onSelect(n, String(n))}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
