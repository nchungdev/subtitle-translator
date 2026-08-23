// Generic caller for any OpenAI-compatible chat/completions endpoint —
// covers OpenCode Zen, DeepSeek (native), Groq, OpenRouter, OpenAI, Qwen, SiliconFlow, Zhipu, etc.
// (Gemini and Claude have their own API shapes — see geminiClient.ts and claudeClient.ts).

export interface OpenAICompatCallResult {
  text: string;
}

export const callOpenAICompat = async (params: {
  endpoint: string;
  /** Absent for no-auth local servers (Ollama, LM Studio, llama.cpp) — omits the Authorization header entirely rather than sending an empty Bearer token. */
  apiKey?: string;
  model: string;
  system: string;
  user: string;
  extraHeaders?: Record<string, string>;
}): Promise<OpenAICompatCallResult> => {
  const makeBody = (includeJsonFormat: boolean) =>
    JSON.stringify({
      model: params.model,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      stream: false,
      ...(includeJsonFormat ? { response_format: { type: "json_object" } } : {}),
    });

  let res = await fetch(params.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
      ...params.extraHeaders,
    },
    body: makeBody(true),
  });

  if (!res.ok && (res.status === 400 || res.status === 422)) {
    res = await fetch(params.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
        ...params.extraHeaders,
      },
      body: makeBody(false),
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`API error ${res.status}: ${body.slice(0, 500)}`), { status: res.status });
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("Response truncated (finish_reason=length) — the episode may be too long for one call.");
  }
  const text = choice?.message?.content;
  if (typeof text !== "string") {
    throw new Error(`Invalid response format: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return { text };
};

/** Known endpoints for LLM providers aligned with the app's Translation Providers. */
export const KNOWN_PROVIDER_ENDPOINTS: Record<
  string,
  { endpoint: string; defaultModel?: string; extraHeaders?: Record<string, string>; requiresApiKey?: boolean }
> = {
  openai: { endpoint: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-5.6-luna" },
  deepseek: { endpoint: "https://api.deepseek.com/chat/completions", defaultModel: "deepseek-v4-flash" },
  qwen: { endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", defaultModel: "qwen3.7-plus" },
  siliconflow: { endpoint: "https://api.siliconflow.cn/v1/chat/completions", defaultModel: "deepseek-ai/DeepSeek-V4-Flash" },
  zhipu: { endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", defaultModel: "glm-5.2" },
  doubao: { endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", defaultModel: "doubao-seed-2-1-turbo-260628" },
  minimax: { endpoint: "https://api.minimaxi.com/v1/chat/completions", defaultModel: "MiniMax-M3" },
  qianfan: { endpoint: "https://qianfan.baidubce.com/v2/chat/completions", defaultModel: "ernie-5.1" },
  mistral: { endpoint: "https://api.mistral.ai/v1/chat/completions", defaultModel: "mistral-medium-3-5" },
  grok: { endpoint: "https://api.x.ai/v1/chat/completions", defaultModel: "grok-4.5" },
  perplexity: { endpoint: "https://api.perplexity.ai/chat/completions", defaultModel: "sonar" },
  cohere: { endpoint: "https://api.cohere.ai/compatibility/v1/chat/completions", defaultModel: "command-a-plus-05-2026" },
  opencode: { endpoint: "https://opencode.ai/zen/v1/chat/completions", defaultModel: "deepseek-v4-flash-free" },
  groq: { endpoint: "https://api.groq.com/openai/v1/chat/completions", defaultModel: "openai/gpt-oss-120b" },
  openrouter: {
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "deepseek/deepseek-v4-flash",
    extraHeaders: { "HTTP-Referer": "https://aishort.top", "X-Title": "AIShort" },
  },
  moonshot: { endpoint: "https://api.moonshot.ai/v1/chat/completions", defaultModel: "kimi-k2.6" },
  ollama: { endpoint: "http://127.0.0.1:11434/v1/chat/completions", requiresApiKey: false },
};
