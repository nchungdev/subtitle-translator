// Minimal standalone Gemini caller for the character-graph extraction step.
//
// Deliberately NOT reusing src/app/lib/translation/services/llm.ts's `gemini`
// TranslationService: that function is wired to the line-by-line batch
// translation contract (N source lines in, N translated lines out, via
// preparePrompts). This call is a different shape entirely — one big
// system+user prompt in, one JSON object out — so a small dedicated request
// here is simpler and clearer than bending the batch-translation service to
// fit. The auth header and endpoint match the app's own gemini service
// (x-goog-api-key, v1beta generateContent) so behavior stays consistent with
// what's already verified to work there.

export interface GeminiCallResult {
  text: string;
}

export const callGemini = async (params: { apiKey: string; model: string; system: string; user: string }): Promise<GeminiCallResult> => {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": params.apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: params.user }] }],
      systemInstruction: { parts: [{ text: params.system }] },
      // JSON mode: Gemini enforces valid-JSON output shape at the API level —
      // cheap insurance against markdown fences or leading commentary, on top
      // of the prompt's own "no markdown fences" instruction.
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`Gemini API error ${res.status}: ${body.slice(0, 500)}`), { status: res.status });
  }

  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> };
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error("Gemini response truncated — max_tokens reached. The episode may be too long for one call.");
  }
  const text = candidate?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`Invalid response format from Gemini API: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return { text };
};
