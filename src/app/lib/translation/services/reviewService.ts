import { callGemini } from "../../../../../scripts/characterGraph/geminiClient";
import { callClaude } from "../../../../../scripts/characterGraph/claudeClient";
import { callOpenAICompat, KNOWN_PROVIDER_ENDPOINTS } from "../../../../../scripts/characterGraph/openAICompatClient";
import { resolveWireEndpoint } from "../registry";
import { parseCues } from "@/app/[locale]/subtitleCues";

export interface SubtitleReviewIssue {
  lineIndex: number; // 1-based index matching SubtitleCue
  timecode?: string;
  original: string;
  draft: string;
  suggested: string;
  category: "terminology" | "grammar" | "untranslated" | "length" | "other";
  reason: string;
  applied?: boolean;
  fileId?: string;
  fileName?: string;
}

export interface ReviewOptions {
  provider: string;
  apiKey?: string;
  model?: string;
  endpoint?: string;
  checkTerminology?: boolean;
  checkGrammar?: boolean;
  checkLength?: boolean;
  checkUntranslated?: boolean;
  contextText?: string;
  characterGraphText?: string;
  signal?: AbortSignal;
  onChunkIssues?: (newIssues: SubtitleReviewIssue[]) => void;
}

/**
 * Sends source and draft translation cues to AI LLM for automated quality review.
 */
export async function auditSubtitleCues(
  sourceText: string,
  draftText: string,
  format: string,
  options: ReviewOptions,
  onProgress?: (processed: number, total: number) => void
): Promise<SubtitleReviewIssue[]> {
  const sourceCues = parseCues(sourceText, format);
  const draftCues = parseCues(draftText, format);

  if (sourceCues.length === 0 || draftCues.length === 0) {
    return [];
  }

  const BATCH_SIZE = 40;
  const totalCues = Math.min(sourceCues.length, draftCues.length);
  const allIssues: SubtitleReviewIssue[] = [];

  for (let i = 0; i < totalCues; i += BATCH_SIZE) {
    if (options.signal?.aborted) {
      break;
    }

    const batchSource = sourceCues.slice(i, i + BATCH_SIZE);
    const batchDraft = draftCues.slice(i, i + BATCH_SIZE);

    const cuePairs = batchSource
      .map((sc, idx) => {
        const dc = batchDraft[idx];
        return `[Cue #${sc.index}]
Source: ${sc.text.replace(/\n/g, " ")}
Draft: ${dc ? dc.text.replace(/\n/g, " ") : ""}`;
      })
      .join("\n\n");

    const systemPrompt = `You are a conservative, expert Vietnamese subtitle proofreader.
Your SOLE PURPOSE is to find clear, objective errors in draft translations.

CRITICAL CONSERVATIVE PROOFREADING RULES:
1. DO NOT OVER-CORRECT OR REPHRASE GOOD TRANSLATIONS! If a draft translation is natural, fluent, and conveys the source meaning accurately in Vietnamese, YOU MUST LEAVE IT ALONE and DO NOT include it in the output.
2. DO NOT change a line just to express a personal stylistic preference or alternative wording.
3. ONLY report an issue if there is a CLEAR, UNDENIABLE ERROR:
   - Wrong character names or pronouns violating the provided Character Graph / Pronoun rules ("terminology").
   - Severe grammatical failure, broken syntax, or unreadable Vietnamese ("grammar").
   - Text still left in English/Japanese/Chinese without translation ("untranslated").
   - Subtitle line exceeding 80 characters ("length").
4. When suggesting a fix ("suggested"), make minimal edits to fix ONLY the exact flaw while keeping as much of the original draft intact as possible.

Return ONLY a valid JSON array of issue objects with the following schema:
[
  {
    "lineIndex": 1,
    "original": "Original source text",
    "draft": "Current draft text",
    "suggested": "Fixed translation (minimal edit)",
    "category": "terminology" | "grammar" | "untranslated" | "length" | "other",
    "reason": "Clear explanation of the flaw in Vietnamese"
  }
]
If there are no clear errors in the batch, return an empty array: []`;

    const contextBlock = [
      options.contextText ? `[Bối cảnh tóm tắt phim (Movie Context)]:\n${options.contextText}` : "",
      options.characterGraphText ? `[Bảng Quy tắc Quan hệ & Xưng hô Nhân vật (Character Pronoun Rules)]:\n${options.characterGraphText}` : "",
    ].filter(Boolean).join("\n\n") || "Chưa thiết lập bối cảnh hay xưng hô.";

    const userPrompt = `${contextBlock}

[Cấu hình Tiêu chí Kiểm tra]:
- Kiểm tra Xưng hô / Đại từ: ${options.checkTerminology !== false ? "CÓ (BẮT BUỘC tuân thủ Bảng Quan hệ xưng hô ở trên)" : "KHÔNG"}
- Kiểm tra Ngữ pháp & Văn phong: ${options.checkGrammar !== false ? "CÓ" : "KHÔNG"}
- Kiểm tra Độ dài câu (>80 ký tự): ${options.checkLength !== false ? "CÓ" : "KHÔNG"}
- Kiểm tra Cụm từ chưa dịch: ${options.checkUntranslated !== false ? "CÓ" : "KHÔNG"}

[Danh sách các đoạn phụ đề cần kiểm duyệt]:
${cuePairs}`;

    try {
      const rawText = await callLLMRaw(systemPrompt, userPrompt, options);
      const parsedIssues = parseReviewResponseJson(rawText, batchSource, batchDraft);
      if (parsedIssues.length > 0) {
        allIssues.push(...parsedIssues);
        options.onChunkIssues?.(parsedIssues);
      }
    } catch (err) {
      console.error(`Batch audit failed for cues ${i + 1}-${i + batchSource.length}:`, err);
    }

    onProgress?.(Math.min(i + BATCH_SIZE, totalCues), totalCues);
  }

  return allIssues;
}

async function callLLMRaw(system: string, user: string, options: ReviewOptions): Promise<string> {
  const providerKey = (options.provider || "gemini").toLowerCase();

  if (providerKey === "gemini") {
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("Chưa có API Key cho Gemini. Vui lòng kiểm tra cấu hình.");
    const res = await callGemini({ apiKey, model: options.model || "gemini-2.5-flash", system, user });
    return res.text;
  } else if (providerKey === "claude") {
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "";
    if (!apiKey) throw new Error("Chưa có API Key cho Claude. Vui lòng kiểm tra cấu hình.");
    const res = await callClaude({ apiKey, model: options.model || "claude-3-5-haiku-20241022", system, user });
    return res.text;
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
    return res.text;
  }
}

function parseReviewResponseJson(raw: string, batchSource: any[], batchDraft: any[]): SubtitleReviewIssue[] {
  let cleanText = raw.trim();
  cleanText = cleanText.replace(/```json/gi, "").replace(/```/g, "").trim();

  try {
    const jsonStart = cleanText.indexOf("[");
    const jsonEnd = cleanText.lastIndexOf("]");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
    }
    const arr = JSON.parse(cleanText);
    if (!Array.isArray(arr)) return [];

    return arr.map((item: any) => {
      const lineIndex = Number(item.lineIndex || item.index || item.id || 1);
      const draftObj = batchDraft.find((d) => d.index === lineIndex);
      const srcObj = batchSource.find((s) => s.index === lineIndex);

      return {
        lineIndex,
        timecode: draftObj ? formatMsToTimecode(draftObj.startMs) : undefined,
        original: item.original || srcObj?.text || "",
        draft: item.draft || draftObj?.text || "",
        suggested: item.suggested || item.suggestedRevision || item.fix || item.draft || "",
        category: item.category || "other",
        reason: item.reason || item.explanation || item.note || "Phát hiện vấn đề chất lượng",
        applied: false,
      };
    });
  } catch (err) {
    console.warn("Could not parse review JSON response:", err);
    return [];
  }
}

function formatMsToTimecode(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
