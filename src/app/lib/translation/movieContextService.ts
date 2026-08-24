import { callGemini } from "../../../../scripts/characterGraph/geminiClient";
import { callClaude } from "../../../../scripts/characterGraph/claudeClient";
import { callOpenAICompat, KNOWN_PROVIDER_ENDPOINTS } from "../../../../scripts/characterGraph/openAICompatClient";
import { resolveWireEndpoint } from "./registry";

export interface MovieContextOptions {
  provider: string;
  apiKey?: string;
  model?: string;
  endpoint?: string;
}

/**
 * Helper to execute LLM prompt across supported providers (Gemini, Claude, OpenAI-compat)
 */
async function callLLM(system: string, user: string, options: MovieContextOptions): Promise<string> {
  const providerKey = (options.provider || "gemini").toLowerCase();

  if (options.apiKey && options.apiKey.trim().endsWith(":fx") && providerKey !== "deepl") {
    throw new Error(`Khóa API bạn đang dùng kết thúc bằng ':fx' (API Key của DeepL). Không thể dùng API Key của DeepL cho nhà cung cấp AI ${options.provider.toUpperCase()}. Vui lòng kiểm tra lại API Key.`);
  }

  if (providerKey === "gemini") {
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("Chưa có API Key cho Google Gemini. Vui lòng kiểm tra cấu hình API.");
    const res = await callGemini({
      apiKey,
      model: options.model || "gemini-2.5-flash",
      system,
      user,
    });
    return res.text;
  } else if (providerKey === "claude") {
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "";
    if (!apiKey) throw new Error("Chưa có API Key cho Anthropic Claude. Vui lòng kiểm tra cấu hình API.");
    const res = await callClaude({
      apiKey,
      model: options.model || "claude-3-5-haiku-20241022",
      system,
      user,
    });
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
      throw new Error(`Chưa có API Key cho ${options.provider.toUpperCase()}. Vui lòng kiểm tra cấu hình API.`);
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

/**
 * Generate initial Movie Synopsis & Plot Context from a URL (Wikipedia, IMDb, TMDB) or text description.
 */
export async function generateMovieContextFromInput(
  inputUrlOrText: string,
  options: MovieContextOptions
): Promise<string> {
  const system = `Bạn là chuyên gia phân tích bối cảnh phim điện ảnh và truyền hình. 
Nhiệm vụ của bạn là đọc thông tin về bộ phim được tổng hợp từ một hoặc nhiều nguồn (Wikipedia, IMDb, TMDB hoặc đoạn mô tả được cung cấp), sau đó tổng hợp & đối chiếu thông tin để tạo thành một BẢN BỐI CẢNH TỔNG HỢP CHUẨN XÁC VÀ ĐẦY ĐỦ NHẤT bằng tiếng Việt.

Yêu cầu định dạng đầu ra:
Nếu xuất ra định dạng JSON, BẮT BUỘC dùng tên trường (field names) hoàn toàn bằng TIẾNG ANH như sau:
- title: [Tên tiếng Việt / Tên gốc / Tên tiếng Anh]
- season_episodes: [Ví dụ: Season 1 / Mùa 1 (45 tập), hoặc Phim điện ảnh / Movie]
- release_year: [Ví dụ: 1988 hoặc 2024]
- synopsis: [2-3 câu ngắn gọn, tổng hợp nội dung chính từ các nguồn]
- setting: [Ví dụ: Thế giới ma thuật Soukaizan, năm 1988]
- characters: [Danh sách nhân vật: vai trò / tính cách trong phim]

Giữ nội dung cô đọng, rõ ràng, dễ hiểu để dùng làm bối cảnh dịch thuật phụ đề. Không thêm giải thích thừa.`;

  const user = `Thông tin các nguồn dữ liệu bộ phim được cung cấp:\n${inputUrlOrText.trim()}`;

  return await callLLM(system, user, options);
}

/**
 * Extract detailed Character Relationship & Forms of Address rules from sample subtitle texts.
 */
export async function extractDetailedCharacterGraphFromSampleSubtitles(
  sampleTexts: string[],
  initialContext: string,
  options: MovieContextOptions
): Promise<string> {
  const combinedSamples = sampleTexts.join("\n\n---\n\n").slice(0, 30000); // Limit to ~30k chars

  const system = `Bạn là chuyên gia bản ngữ và dịch thuật phụ đề phim chuyên nghiệp.
Nhiệm vụ của bạn là dựa vào [Bối cảnh phim ban đầu] và [Các đoạn thoại phụ đề mẫu] được cung cấp, trích xuất ra BẢNG QUY TẮC QUAN HỆ & XƯNG HÔ NHÂN VẬT 2 CHIỀU CHUẨN HÓA VÀ ĐỒNG NHẤT 100%.

YÊU CẦU QUAN TRỌNG VỀ ĐẠI TỪ:
- Với mỗi chiều, CHỈ CHỌN ĐÚNG 1 TỪ GỌI DUY NHẤT VÀ 1 TỪ XƯNG DUY NHẤT. 
- KHÔNG liệt kê nhiều từ lựa chọn bằng dấu gạch chéo (KHÔNG viết "tôi / mình", "anh / tớ", "cậu / Ryujinmaru"). Việc có nhiều lựa chọn sẽ làm AI dịch bị loạn đại từ xưng hô mid-scene.
- Chọn từ xưng hô phù hợp nhất với tính cách nhân vật và mối quan hệ để cố định xuyên suốt phim.

YÊU CẦU ĐỊNH DẠNG JSON:
Nếu xuất ra JSON, BẮT BUỘC dùng tên trường (field names) bằng TIẾNG ANH như sau:
- character_a: Tên nhân vật A
- character_b: Tên nhân vật B
- a_calls_b: Chuỗi quy tắc hoặc object { tu_goi, tu_xung, moi_quan_he, sac_thai } chiều A -> B
- b_calls_a: Chuỗi quy tắc hoặc object { tu_goi, tu_xung, moi_quan_he, sac_thai } chiều B -> A

Mẫu định dạng gạch đầu dòng (nếu không dùng JSON):
- A gọi B là "[Từ gọi duy nhất]", xưng là "[Từ xưng duy nhất]" [Mối quan hệ: Thầy - Trò / Bạn bè / Đồng đội / Kẻ thù...] (Ghi chú/Sắc thái)

Ví dụ chuẩn:
- Wataru gọi Ryujinmaru là "Ryujinmaru", xưng là "tôi" [Mối quan hệ: Đồng đội / Ma thần & Cứu thế chủ] (Thân mật, tôn trọng)
- Ryujinmaru gọi Wataru là "Wataru", xưng là "ta" [Mối quan hệ: Đồng đội / Ma thần & Cứu thế chủ] (Trang trọng, bảo hộ)

Hãy trích xuất tất cả các nhân vật xuất hiện trong phụ đề mẫu và chốt 1 ĐẠI TỪ DUY NHẤT 2 chiều để làm quy tắc dịch cố định.`;

  const user = `[Bối cảnh phim ban đầu]:\n${initialContext || "Chưa có"}\n\n[Đoạn thoại phụ đề mẫu]:\n${combinedSamples}`;

  return await callLLM(system, user, options);
}
