import { extractDialogueLines } from "../../../../scripts/characterGraph/extract";
import { buildCharacterGraphPrompt } from "../../../../scripts/characterGraph/prompt";
import { validateCharacterGraph } from "../../../../scripts/characterGraph/validate";
import { callGemini } from "../../../../scripts/characterGraph/geminiClient";
import { callClaude } from "../../../../scripts/characterGraph/claudeClient";
import { callOpenAICompat, KNOWN_PROVIDER_ENDPOINTS } from "../../../../scripts/characterGraph/openAICompatClient";
import type { CharacterGraph } from "../../../../scripts/characterGraph/schema";
import { parseAssDialogueStyles } from "./formats/subtitle";
import { resolveWireEndpoint } from "./registry";

export interface ExtractCharacterGraphOptions {
  sourceFileName: string;
  provider: string;
  apiKey?: string;
  model?: string;
  endpoint?: string;
  groundingTrackLabel?: string;
}

/**
 * Extract CharacterGraph (characters & formsOfAddress) from subtitle text using LLM.
 */
export const extractCharacterGraphFromText = async (
  sourceText: string,
  options: ExtractCharacterGraphOptions,
): Promise<CharacterGraph | null> => {
  try {
    const parsedStyles = parseAssDialogueStyles(sourceText);
    const styleNames = parsedStyles.map((s) => s.name);
    const dialogueLines = extractDialogueLines(sourceText, styleNames.length > 0 ? styleNames : ["Default"]);

    if (dialogueLines.length === 0) return null;

    const groundingLabel = options.groundingTrackLabel || "Source";
    const promptInput = {
      sourceFileName: options.sourceFileName || "subtitle.ass",
      groundingTrackLabel: groundingLabel,
      groundingLines: dialogueLines,
      otherTracks: [],
    };

    const { system, user } = buildCharacterGraphPrompt(promptInput);

    const providerKey = options.provider.toLowerCase();
    if (options.apiKey && options.apiKey.trim().endsWith(":fx") && providerKey !== "deepl") {
      throw new Error(`Khóa API bạn đang dùng kết thúc bằng ':fx' (API Key của DeepL). Không thể dùng API Key của DeepL cho nhà cung cấp AI ${options.provider.toUpperCase()}. Vui lòng kiểm tra lại API Key.`);
    }
    let rawJsonText = "";

    if (providerKey === "gemini") {
      const apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
      if (!apiKey) throw new Error("Chưa có API Key cho Google Gemini. Vui lòng kiểm tra cấu hình.");
      const res = await callGemini({
        apiKey,
        model: options.model || "gemini-2.5-flash",
        system,
        user,
      });
      rawJsonText = res.text;
    } else if (providerKey === "claude") {
      const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "";
      if (!apiKey) throw new Error("Chưa có API Key cho Anthropic Claude. Vui lòng kiểm tra cấu hình.");
      const res = await callClaude({
        apiKey,
        model: options.model || "claude-3-5-haiku-20241022",
        system,
        user,
      });
      rawJsonText = res.text;
    } else {
      const known = KNOWN_PROVIDER_ENDPOINTS[providerKey];
      const directEndpoint = known?.endpoint || "https://api.openai.com/v1/chat/completions";
      const endpoint = resolveWireEndpoint(providerKey, {
        url: options.endpoint || directEndpoint,
        useRelay: providerKey === "opencode" || providerKey === "openrouter",
      });

      const apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
      if (known?.requiresApiKey !== false && !apiKey) {
        throw new Error(`Chưa có API Key cho ${options.provider.toUpperCase()}. Vui lòng kiểm tra cấu hình.`);
      }

      const res = await callOpenAICompat({
        endpoint,
        apiKey: apiKey || undefined,
        model: options.model || known?.defaultModel || "gpt-4o-mini",
        system,
        user,
        extraHeaders: known?.extraHeaders,
      });
      rawJsonText = res.text;
    }

    const validated = validateCharacterGraph(rawJsonText);
    return validated;
  } catch (error) {
    console.warn("Character Graph extraction failed:", error);
    throw error;
  }
};

/**
 * Format a CharacterGraph into a prompt block for the line-by-line translation system prompt.
 */
export const buildCharacterGraphPromptBlock = (graph: CharacterGraph): string => {
  if (!graph || !graph.formsOfAddress || graph.formsOfAddress.length === 0) return "";

  const lines: string[] = [];
  lines.push("### CHARACTER RELATIONSHIPS & FORMS OF ADDRESS RULES (STRICT CONSISTENCY REQUIREMENT):");
  lines.push("Maintain identity-consistent pronouns and forms of address based on speaker and listener pairs:");

  for (const entry of graph.formsOfAddress) {
    const speaker = entry.usedBy;
    const addressee = entry.usedFor;
    const term = entry.term;
    const selfRef = entry.selfReference ? `, Self-reference: "${entry.selfReference}"` : "";
    const reg = entry.register ? ` (${entry.register})` : "";
    lines.push(`- Speaker [${speaker}] addressing [${addressee}]: Call as "${term}"${selfRef}${reg}`);
  }

  lines.push("Crucial: Ensure first-person self-references (I/me) and second-person addressee terms (you) strictly match these reciprocity relationships!");
  return "\n\n" + lines.join("\n");
};
