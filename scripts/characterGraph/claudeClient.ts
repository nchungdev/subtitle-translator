// Claude Anthropic API caller for CharacterGraph prototype.
// Supports official Anthropic Messages API (https://api.anthropic.com/v1/messages)
// or custom reverse proxy endpoints.

export interface ClaudeCallResult {
  text: string;
}

export const callClaude = async (params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  endpoint?: string;
}): Promise<ClaudeCallResult> => {
  const endpoint = params.endpoint || "https://api.anthropic.com/v1/messages";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: params.model,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
      max_tokens: 8096,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`Claude API error ${res.status}: ${body.slice(0, 500)}`), { status: res.status });
  }

  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = data.content?.find((c) => c.type === "text")?.text ?? data.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`Invalid response format from Claude API: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return { text };
};
