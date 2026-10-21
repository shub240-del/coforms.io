import { invokeLLM, listLLMModels, type Message } from "./_core/llm";
import { QUESTION_TYPES, questionInputSchema } from "./forms";

const draftSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: QUESTION_TYPES.map(type => type === "hidden_field" ? "hidden" : type) },
          label: { type: "string" },
          description: { type: "string" },
          required: { type: "boolean" },
          options: { type: "array", items: { type: "string" } },
        },
        required: ["type", "label", "description", "required", "options"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "description", "questions"],
  additionalProperties: false,
} as const;

async function selectAvailableModel() {
  const configured = process.env.MANUS_LLM_MODEL || process.env.NVIDIA_MODEL;
  if (configured) return configured;
  if (process.env.NVIDIA_API_KEY) return "nvidia/nemotron-3-ultra-550b-a55b";
  try {
    const catalog = await listLLMModels();
    const available = new Set(catalog.data.map(model => model.id));
    if (available.has("gpt-5-mini")) return "gpt-5-mini";
    const gpt = catalog.data.find(model => model.id.startsWith("gpt-5"))?.id;
    const fallback = gpt ?? catalog.data[0]?.id;
    if (fallback) return fallback;
  } catch {
    // fallback if model catalog cannot be listed
  }
  return "nvidia/nemotron-3-ultra-550b-a55b";
}

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned) as unknown; }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    throw new Error("AI returned invalid JSON.");
  }
}

export async function generateDraft(prompt: string) {
  const model = await selectAvailableModel();
  const systemPrompt = `Create a useful, concise form draft. Use suitable question types, keep the wording clear, and return ONLY a valid JSON object matching this schema:\n${JSON.stringify(draftSchema, null, 2)}\n\nIMPORTANT: Output raw JSON only. No markdown, no code fences, no explanation.`;
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  let response;

  // Attempt 1: strict json_schema (OpenAI-compatible providers)
  try {
    response = await invokeLLM({
      model,
      messages,
      response_format: { type: "json_schema", json_schema: { name: "coforms_draft", strict: true, schema: draftSchema } },
    });
  } catch {
    // Attempt 2: json_object mode
    try {
      response = await invokeLLM({
        model,
        messages,
        response_format: { type: "json_object" },
      });
    } catch {
      // Attempt 3: plain text — works with NVIDIA NIM and other providers that
      // reject structured response_format. The system prompt instructs JSON output.
      response = await invokeLLM({ model, messages });
    }
  }

  const proxyError = (response as unknown as { error?: string | { message?: string } }).error;
  if (proxyError) throw new Error(typeof proxyError === "string" ? proxyError : proxyError.message || "AI drafting failed.");
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new Error("AI returned no draft. Try again or create the form manually.");
  const parsed = parseJson(content);
  const object = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  if (!object || typeof object.title !== "string" || typeof object.description !== "string" || !Array.isArray(object.questions)) throw new Error("AI draft did not match the expected form shape.");
  const questions = object.questions.map(item => questionInputSchema.parse(item));
  return { title: object.title.trim().slice(0, 255), description: object.description.trim().slice(0, 5000), questions };
}

export interface InterviewTurnInput {
  currentQuestion: {
    id: string;
    type: string;
    title: string;
    description?: string | null;
    required?: boolean;
    options?: string[];
    settings?: Record<string, unknown>;
  };
  utterance: string;
  language?: string;
  remainingQuestionCount?: number;
}

export interface InterviewTurnResult {
  assistantMessage: string;
  proposedAnswer?: {
    questionId: string;
    value: any;
    displayValue: string;
  };
  clarificationNeeded: boolean;
  clarificationReason?: string;
}

// Deterministic heuristic fallback when LLM is unavailable or times out
function fallbackExtraction(input: InterviewTurnInput): InterviewTurnResult {
  const text = input.utterance.trim();
  const q = input.currentQuestion;
  const lower = text.toLowerCase();
  const options = q.options || [];

  if (q.type === "yes_no") {
    if (["yes", "yeah", "yep", "sure", "definitely", "true", "ok"].some(w => lower.includes(w))) {
      return { assistantMessage: "Got it, thank you!", proposedAnswer: { questionId: q.id, value: "Yes", displayValue: "Yes" }, clarificationNeeded: false };
    }
    if (["no", "nope", "nah", "negative", "false"].some(w => lower.includes(w))) {
      return { assistantMessage: "Understood, noted as no.", proposedAnswer: { questionId: q.id, value: "No", displayValue: "No" }, clarificationNeeded: false };
    }
    return { assistantMessage: 'Could you please confirm with a simple "Yes" or "No"?', clarificationNeeded: true, clarificationReason: 'Expected "Yes" or "No".' };
  }

  if (q.type === "rating") {
    const numMatch = text.match(/\b([1-5])\b/);
    const wordMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const val = numMatch ? Number(numMatch[1]) : wordMap[lower];
    if (val && val >= 1 && val <= 5) {
      return { assistantMessage: `Thank you for the ${val}-star rating!`, proposedAnswer: { questionId: q.id, value: val, displayValue: `${val} stars` }, clarificationNeeded: false };
    }
    return { assistantMessage: "Please provide a score from 1 to 5.", clarificationNeeded: true, clarificationReason: "Rating must be between 1 and 5." };
  }

  if (q.type === "single_choice" || q.type === "dropdown") {
    const exact = options.find(o => o.toLowerCase() === lower);
    if (exact) {
      return { assistantMessage: `Great, selected ${exact}.`, proposedAnswer: { questionId: q.id, value: exact, displayValue: exact }, clarificationNeeded: false };
    }
    const matched = options.filter(o => o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase()));
    if (matched.length === 1) {
      return { assistantMessage: `Got it, ${matched[0]}.`, proposedAnswer: { questionId: q.id, value: matched[0], displayValue: matched[0] }, clarificationNeeded: false };
    }
    return {
      assistantMessage: options.length ? `Could you choose one of the available options: ${options.join(", ")}?` : "Could you clarify your choice?",
      clarificationNeeded: true,
      clarificationReason: "Answer did not match any available option.",
    };
  }

  if (q.type === "email") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = text.replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s+/g, "");
    if (emailRegex.test(cleanEmail)) {
      return { assistantMessage: `Thanks! Noted your email as ${cleanEmail}.`, proposedAnswer: { questionId: q.id, value: cleanEmail, displayValue: cleanEmail }, clarificationNeeded: false };
    }
    return { assistantMessage: "Please provide a valid email address.", clarificationNeeded: true, clarificationReason: "Invalid email format." };
  }

  // Default text response
  return {
    assistantMessage: "Thank you, noted!",
    proposedAnswer: { questionId: q.id, value: text, displayValue: text },
    clarificationNeeded: false,
  };
}

export async function generateInterviewTurn(input: InterviewTurnInput): Promise<InterviewTurnResult> {
  const q = input.currentQuestion;
  const lang = input.language || "en";

  const systemPrompt = `You are an empathetic, professional research interviewer for CoForms.
The respondent is answering an official research question.
Active Question: "${q.title}"
Question Type: "${q.type}"
Allowed Options: ${JSON.stringify(q.options || [])}
Target Response Language: ${lang}

Respondent said: "${input.utterance}"

Instructions:
1. Extract the respondent's intended answer into "proposedValue".
   - If question type is "rating", proposedValue MUST be an integer from 1 to 5.
   - If question type is "yes_no", proposedValue MUST be "Yes" or "No".
   - If question type is "single_choice" or "dropdown", proposedValue MUST be one of the Allowed Options.
   - If question type is "multiple_choice", proposedValue MUST be an array of matching Allowed Options.
   - If question type is "email", proposedValue MUST be a valid email string.
   - If question type is "number", proposedValue MUST be a finite number.
   - If question type is "short_text" or "long_text", proposedValue MUST be a clean string.
2. If the respondent's utterance is ambiguous, off-topic, or refuses to answer, set "clarificationNeeded": true and explain in "clarificationReason".
3. Provide an "assistantMessage" in ${lang}:
   - If answer is clear, acknowledge their answer naturally and briefly.
   - If clarification is needed, politely ask them to clarify or choose from available options.

OUTPUT FORMAT: Return raw JSON only with these keys:
{
  "assistantMessage": string,
  "proposedValue": any or null,
  "displayValue": string,
  "clarificationNeeded": boolean,
  "clarificationReason": string or null
}`;

  try {
    const model = await selectAvailableModel();
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input.utterance },
    ];

    let response;
    try {
      response = await invokeLLM({
        model,
        messages,
        response_format: { type: "json_object" },
        max_tokens: 300,
      });
    } catch {
      response = await invokeLLM({ model, messages, max_tokens: 300 });
    }

    const content = response.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
      const parsed = parseJson(content) as Record<string, unknown>;
      if (parsed && typeof parsed.assistantMessage === "string") {
        const clarificationNeeded = Boolean(parsed.clarificationNeeded);
        const clarificationReason = typeof parsed.clarificationReason === "string" ? parsed.clarificationReason : undefined;
        let proposedAnswer: { questionId: string; value: any; displayValue: string } | undefined = undefined;

        if (!clarificationNeeded && parsed.proposedValue !== undefined && parsed.proposedValue !== null) {
          // Strictly map to q.id - never accept model-invented question IDs
          proposedAnswer = {
            questionId: q.id,
            value: parsed.proposedValue,
            displayValue: typeof parsed.displayValue === "string" ? parsed.displayValue : String(parsed.proposedValue),
          };
        }

        return {
          assistantMessage: parsed.assistantMessage.trim(),
          proposedAnswer,
          clarificationNeeded,
          clarificationReason,
        };
      }
    }
  } catch {
    // Model invocation failure - fall back to deterministic heuristic parsing safely
  }

  return fallbackExtraction(input);
}
