// Config migration utilities. Provider data lives in `./registry`.

import type { TranslationConfig } from "./types";

export const DEFAULT_SYSTEM_PROMPT = "You are a professional translator. Respond only with the content, either translated or rewritten. Do not add explanations, comments, or any extra text.";
export const DEFAULT_USER_PROMPT = "Please respect the original meaning, maintain the original format, and rewrite the following content in ${targetLanguage}.\n\n${content}";

// Fields to preserve when resetting config to defaults (user credentials should not be lost).
// apiVersion (Azure OpenAI), region (Azure Translate), and folderId (Yandex) are effectively
// credential-adjacent — users set them once per deployment/tenant and don't expect a reset
// to forget them.
const PRESERVE_FIELDS: (keyof TranslationConfig)[] = ["apiKey", "url", "apiVersion", "region", "folderId"];

/**
 * Reset config to defaults while preserving user credential fields (apiKey, url, apiVersion, region, folderId).
 * Used by the explicit "Reset" button.
 */
export const resetConfigWithCredentials = (currentConfig: TranslationConfig | undefined, defaultConfig: TranslationConfig | undefined): TranslationConfig => {
  const preserved: Partial<TranslationConfig> = {};
  if (currentConfig) {
    for (const field of PRESERVE_FIELDS) {
      if (currentConfig[field] !== undefined) {
        (preserved as Record<string, unknown>)[field] = currentConfig[field];
      }
    }
  }
  return { ...defaultConfig, ...preserved };
};

/**
 * Graceful config migration for stored user configs.
 *
 * When defaults evolve (new fields added, old fields removed), this merges
 * defaults into the saved config so missing fields get backfilled and obsolete
 * fields get pruned — without resetting the user's valid choices (model,
 * temperature, apiKey, ...). Explicit user-initiated resets should still call
 * resetConfigWithCredentials.
 */
export const migrateConfig = (saved: TranslationConfig | undefined, defaults: TranslationConfig | undefined): TranslationConfig => {
  if (!defaults) return { ...(saved ?? {}) };
  if (!saved) return { ...defaults };
  const merged: Record<string, unknown> = { ...defaults, ...saved };
  // Drop keys that no longer exist in defaults (removed fields)
  for (const key of Object.keys(merged)) {
    if (!(key in defaults)) delete merged[key];
  }
  return merged as TranslationConfig;
};

/**
 * Genre Styles for specialized subtitle translation
 */
export interface GenreStyleOption {
  value: string;
  label: string;
  instruction: string;
}

export const GENRE_STYLE_OPTIONS: GenreStyleOption[] = [
  { value: "default", label: "Mặc định (Dịch tự nhiên / Chuẩn mực)", instruction: "" },
  { value: "action", label: "🎬 Hành động / Giật gân", instruction: "Dịch dồn dập, dứt khoát, thoại ngắn gọn, sử dụng khẩu ngữ tự nhiên phù hợp phim hành động." },
  { value: "comedy", label: "🎭 Hài hước / Sitcom", instruction: "Dịch dí dỏm, hài hước, bắt trend tự nhiên, chọn từ ngữ gây cười phù hợp ngữ cảnh." },
  { value: "historical", label: "🗡️ Cổ trang / Kiếm hiệp", instruction: "Văn phong trang trọng, mang âm hưởng Hán Việt/Cổ phong, xưng hô tôn ti trật tự cổ đại." },
  { value: "anime", label: "🌸 Anime / Manga", instruction: "Văn phong trẻ trung, giữ nguyên sắc thái biểu cảm phong phú và văn hóa Anime/Manga." },
  { value: "romance", label: "💘 Tình cảm / Lãng mạn", instruction: "Văn phong nhẹ nhàng, tinh tế, giàu cảm xúc và sâu lắng phù hợp phim tình cảm." },
  { value: "horror", label: "💀 Kinh dị / Trinh thám", instruction: "Văn phong u uất, kịch tính, lôi cuốn, tạo cảm giác hồi hộp bí ẩn." },
  { value: "documentary", label: "🧪 Tài liệu / Khoa học", instruction: "Văn phong chuẩn mực, khách quan, chính xác tuyệt đối về thuật ngữ chuyên ngành." },
];

export const buildPromptWithContext = (
  baseSystemPrompt: string,
  genreStyle?: string,
  movieSynopsis?: string
): string => {
  let decorated = baseSystemPrompt;
  const genreOpt = GENRE_STYLE_OPTIONS.find((g) => g.value === genreStyle && g.instruction);

  if (movieSynopsis?.trim() || genreOpt) {
    const extraBlocks: string[] = [];

    if (movieSynopsis?.trim()) {
      extraBlocks.push(`[Movie Synopsis / Plot Context]:\n${movieSynopsis.trim()}`);
    }

    if (genreOpt) {
      extraBlocks.push(`[Genre Translation Style Requirement]:\n${genreOpt.instruction}`);
    }

    decorated = `${decorated}\n\n### MOVIE CONTEXT & GENRE STYLE INSTRUCTIONS:\n${extraBlocks.join("\n\n")}`;
  }

  return decorated;
};
