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
