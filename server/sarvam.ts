/**
 * Sarvam AI server-side proxy helpers.
 *
 * Sarvam API: https://docs.sarvam.ai/
 *   - STT: Saaras  (POST /speech-to-text)
 *   - TTS: Bulbul  (POST /text-to-speech)
 *
 * The SARVAM_API_KEY environment variable is read exclusively on the server.
 * It must never be forwarded to the browser or logged anywhere.
 */

const SARVAM_BASE = "https://api.sarvam.ai";

// Language code mapping: CoForms lang code → Sarvam BCP-47
const SARVAM_LANG_MAP: Record<string, string> = {
  en: "en-IN",
  hi: "hi-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  od: "od-IN",
  pa: "pa-IN",
  ta: "ta-IN",
  te: "te-IN",
};

function toSarvamLang(lang: string): string {
  return SARVAM_LANG_MAP[lang] ?? lang;
}

function getSarvamKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key || !key.trim()) throw new Error("SARVAM_API_KEY is not configured on the server.");
  return key.trim();
}

// ─────────────────────────────────────────────
// STT — Saaras (speech → text)
// ─────────────────────────────────────────────
export interface SarvamSTTInput {
  /** Raw audio bytes (webm/wav/mp3/ogg).  Max 20 MB. */
  audioBuffer: Buffer;
  /** MIME type of the audio, e.g. "audio/webm" */
  mimeType?: string;
  /** Language code, e.g. "hi" or "hi-IN" */
  language?: string;
}

export interface SarvamSTTResult {
  transcript: string;
  language_code: string;
}

export interface SarvamSTTError {
  error: string;
}

export async function sarvamSTT(
  input: SarvamSTTInput
): Promise<SarvamSTTResult | SarvamSTTError> {
  let key: string;
  try { key = getSarvamKey(); } catch (err) {
    return { error: err instanceof Error ? err.message : "Sarvam key missing" };
  }
  const lang = toSarvamLang(input.language ?? "hi");
  const ext = mimeToExt(input.mimeType ?? "audio/webm");

  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.audioBuffer)], {
    type: input.mimeType ?? "audio/webm",
  });
  form.append("file", blob, `audio.${ext}`);
  form.append("language_code", lang);
  form.append("model", "saaras:v3");

  let res: Response;
  try {
    res = await fetch(`${SARVAM_BASE}/speech-to-text`, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
    });
  } catch (err) {
    return { error: `Sarvam STT network error: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `Sarvam STT ${res.status}: ${body}` };
  }

  const json = (await res.json()) as { transcript?: string; language_code?: string };
  if (typeof json.transcript !== "string") {
    return { error: "Sarvam STT: unexpected response shape" };
  }
  return {
    transcript: json.transcript,
    language_code: json.language_code ?? lang,
  };
}

// ─────────────────────────────────────────────
// TTS — Bulbul (text → speech)
// ─────────────────────────────────────────────
export interface SarvamTTSInput {
  /** Text to synthesize — max 500 chars per request */
  text: string;
  /** Language code, e.g. "hi" or "hi-IN" */
  language?: string;
  /** Speaker name; defaults to a sensible per-language default */
  speaker?: string;
}

export interface SarvamTTSResult {
  /** Base-64–encoded MP3 audio segments, separated by "|" when chunked */
  audioBase64: string;
}

export interface SarvamTTSError {
  error: string;
}

// Sensible default speakers per Sarvam language code
const DEFAULT_SPEAKER: Record<string, string> = {
  "en-IN": "priya",
  "hi-IN": "priya",
  "bn-IN": "priya",
  "gu-IN": "priya",
  "kn-IN": "priya",
  "ml-IN": "priya",
  "mr-IN": "priya",
  "od-IN": "priya",
  "pa-IN": "priya",
  "ta-IN": "priya",
  "te-IN": "priya",
};

export async function sarvamTTS(
  input: SarvamTTSInput
): Promise<SarvamTTSResult | SarvamTTSError> {
  let key: string;
  try { key = getSarvamKey(); } catch (err) {
    return { error: err instanceof Error ? err.message : "Sarvam key missing" };
  }
  const lang = toSarvamLang(input.language ?? "hi");
  const speaker = input.speaker ?? DEFAULT_SPEAKER[lang] ?? "priya";

  // Split into ≤500-char chunks (Sarvam limit per request)
  const chunks = splitTextIntoChunks(input.text.trim(), 500);
  const audioParts: string[] = [];

  for (const chunk of chunks) {
    let res: Response;
    try {
      res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
        method: "POST",
        headers: {
          "api-subscription-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [chunk],
          target_language_code: lang,
          speaker,
          pitch: 0,
          pace: 1.0,
          loudness: 1.5,
          speech_sample_rate: 22050,
          enable_preprocessing: true,
          model: "bulbul:v3",
        }),
      });
    } catch (err) {
      return { error: `Sarvam TTS network error: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `Sarvam TTS ${res.status}: ${body}` };
    }

    const json = (await res.json()) as { audios?: string[] };
    if (!Array.isArray(json.audios) || !json.audios[0]) {
      return { error: "Sarvam TTS: unexpected response shape" };
    }
    audioParts.push(json.audios[0]);
  }

  return { audioBase64: audioParts.join("|") };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
  };
  return map[mimeType] ?? "webm";
}

function splitTextIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  // Prefer splitting on sentence boundaries
  const sentences = text.split(/(?<=[.!?।])\s+/);
  let current = "";
  for (const sent of sentences) {
    if (current.length + sent.length + 1 > maxLen) {
      if (current) chunks.push(current.trim());
      current = sent;
    } else {
      current = current ? `${current} ${sent}` : sent;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
