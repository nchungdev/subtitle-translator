// Character naming/relationship graph — extraction (prototype, standalone
// from the app; see scripts/characterGraph/schema.ts for details).
//
// Parses one ASS file, picks a grounding track, builds the extraction
// prompt, and — when enabled and a valid API key is available — calls an LLM
// to produce the CharacterGraph JSON. Without a key or when disabled,
// gracefully falls back to writing the prompt file only.
//
// Examples:
//   yarn character-graph -i episode01.ass --grounding JP --provider gemini --api-key AI...
//   yarn character-graph -i episode01.ass --grounding JP --provider claude --api-key sk-ant-...
//   yarn character-graph -i episode01.ass --grounding JP --provider openai --api-key sk-...
//   yarn character-graph -i episode01.ass --grounding JP --provider deepseek --api-key sk-...
//   yarn character-graph -i episode01.ass --grounding JP --provider qwen --api-key sk-...
//   yarn character-graph -i episode01.ass --grounding JP --disable
//   yarn character-graph -i episode01.ass --grounding JP --ignore-invalid-key

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeFileBytes } from "../src/app/utils/encoding";
import { parseAssDialogueStyles, detectAssLanguageGroups } from "../src/app/lib/translation/formats/subtitle";
import { extractDialogueLines } from "./characterGraph/extract";
import { buildCharacterGraphPrompt } from "./characterGraph/prompt";
import { callGemini } from "./characterGraph/geminiClient";
import { callClaude } from "./characterGraph/claudeClient";
import { callOpenAICompat, KNOWN_PROVIDER_ENDPOINTS } from "./characterGraph/openAICompatClient";
import { validateCharacterGraph } from "./characterGraph/validate";

const HELP = `character-graph — extract a naming/relationship graph for one subtitle file

Usage: yarn character-graph -i <file.ass> --grounding <STYLE> [options]

Options:
  -i, --input <file>           Input .ass/.ssa file. Required.
  -o, --out-dir <dir>          Output directory. Default: next to the input file.
      --grounding <STYLE>      Style name to treat as the original-language track (e.g. JP).
                                Required when the file has 2+ detected main language tracks.
      --provider <name>        gemini (default) | claude | openai | deepseek | qwen |
                                siliconflow | zhipu | doubao | minimax | qianfan |
                                mistral | grok | perplexity | cohere | opencode | groq |
                                openrouter | moonshot | ollama.
      --url <url>               Custom OpenAI-compatible or Anthropic endpoint.
      --api-key <key>           API key for the chosen provider. Auto-detects provider env vars
                                ($OPENAI_API_KEY, $ANTHROPIC_API_KEY, $GEMINI_API_KEY, etc.)
                                or .character-graph.config.json.
      --model <model>           Model id. Default depends on --provider.
      --disable, --skip         Disable LLM extraction (writes prompt file only).
      --ignore-invalid-key      Skip gracefully if API key is invalid/missing or LLM call fails.
  -h, --help                    Show this help.
`;

const parseCliArgs = () =>
  parseArgs({
    options: {
      input: { type: "string", short: "i" },
      "out-dir": { type: "string", short: "o" },
      grounding: { type: "string" },
      provider: { type: "string" },
      url: { type: "string" },
      "api-key": { type: "string" },
      model: { type: "string" },
      disable: { type: "boolean" },
      skip: { type: "boolean" },
      "ignore-invalid-key": { type: "boolean" },
      "ignore-error": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  }).values;

const readTextFile = async (path: string): Promise<string> => {
  const buf = readFileSync(path);
  return decodeFileBytes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
};

interface CharacterGraphConfig {
  provider?: string;
  apiKey?: string;
  model?: string;
  disabled?: boolean;
  enabled?: boolean;
  ignoreInvalidKey?: boolean;
  /** Back-compat with the gemini-only config shape. */
  geminiApiKey?: string;
}

const readConfig = (): CharacterGraphConfig => {
  const configPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".character-graph.config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as CharacterGraphConfig;
  } catch {
    return {};
  }
};

const getEnvApiKey = (provider: string): string | undefined => {
  switch (provider) {
    case "gemini":
      return process.env.GEMINI_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "claude":
      return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY;
    case "qwen":
      return process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
    case "siliconflow":
      return process.env.SILICONFLOW_API_KEY;
    case "zhipu":
      return process.env.ZHIPU_API_KEY;
    case "groq":
      return process.env.GROQ_API_KEY;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY;
    case "moonshot":
      return process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY;
    case "mistral":
      return process.env.MISTRAL_API_KEY;
    case "grok":
      return process.env.XAI_API_KEY || process.env.GROK_API_KEY;
    case "doubao":
      return process.env.VOLCENGINE_API_KEY || process.env.DOUBAO_API_KEY;
    case "perplexity":
      return process.env.PERPLEXITY_API_KEY;
    case "cohere":
      return process.env.COHERE_API_KEY;
    case "qianfan":
      return process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY;
    default:
      return undefined;
  }
};

const main = async () => {
  const args = parseCliArgs();

  if (args.help || !args.input) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }

  const inputPath = resolve(args.input);
  const text = await readTextFile(inputPath);

  const styles = parseAssDialogueStyles(text);
  if (styles.length === 0) {
    console.error(`No ASS dialogue styles found in ${inputPath} — is this a valid .ass/.ssa file?`);
    process.exit(2);
  }

  const detection = detectAssLanguageGroups(styles);
  if (detection.mainGroups.length === 0) {
    console.error("Could not detect any main dialogue track in this file.");
    process.exit(2);
  }

  console.log(`Detected ${detection.mainGroups.length} main track(s): ${detection.mainGroups.map((g) => `${g.label} (${g.count} lines)`).join(", ")}`);
  if (detection.minorStyles.length > 0) {
    console.log(`Minor styles (not included as dialogue): ${detection.minorStyles.map((s) => s.name).join(", ")}`);
  }

  let groundingGroup = detection.mainGroups.find((g) => g.label === args.grounding);
  if (!groundingGroup) {
    if (detection.mainGroups.length === 1) {
      groundingGroup = detection.mainGroups[0];
      console.log(`Only one main track — using it as grounding: ${groundingGroup.label}`);
    } else {
      console.error(
        args.grounding
          ? `--grounding "${args.grounding}" doesn't match any detected track. Pick one of: ${detection.mainGroups.map((g) => g.label).join(", ")}`
          : `This file has ${detection.mainGroups.length} main tracks — pass --grounding <STYLE> to pick the original-language one (usually the source, e.g. JP), from: ${detection.mainGroups.map((g) => g.label).join(", ")}`,
      );
      process.exit(2);
    }
  }

  const otherGroups = detection.mainGroups.filter((g) => g.label !== groundingGroup!.label);

  const groundingLines = extractDialogueLines(text, groundingGroup.styles);
  const otherTracks = otherGroups.map((g) => ({ label: g.label, lines: extractDialogueLines(text, g.styles) }));

  const prompt = buildCharacterGraphPrompt({
    sourceFileName: basename(inputPath),
    groundingTrackLabel: groundingGroup.label,
    groundingLines,
    otherTracks,
  });

  const outDir = args["out-dir"] ? resolve(args["out-dir"]) : dirname(inputPath);
  mkdirSync(outDir, { recursive: true });
  const base = basename(inputPath, extname(inputPath));
  const promptFile = join(outDir, `${base}.character-graph-prompt.txt`);

  writeFileSync(promptFile, `=== SYSTEM ===\n${prompt.system}\n\n=== USER ===\n${prompt.user}\n`, "utf8");
  console.log(`\nWrote prompt (grounding: ${groundingGroup.label}, ${groundingLines.length} lines, ${otherTracks.length} other track(s)) to:\n  ${promptFile}`);

  const config = readConfig();
  const isExplicitlyDisabled = args.disable || args.skip || config.disabled === true || config.enabled === false;
  if (isExplicitlyDisabled) {
    console.log("\n[CharacterGraph] LLM graph extraction is disabled by setting/flag. Prompt file created; skipping LLM call.");
    return;
  }

  const provider = args.provider || config.provider || "gemini";
  const configMatchesProvider = (config.provider || "gemini") === provider;
  const envKey = getEnvApiKey(provider);
  const apiKey = args["api-key"] || envKey || (configMatchesProvider ? config.apiKey || config.geminiApiKey : undefined);
  const requiresApiKey = provider === "claude" || (KNOWN_PROVIDER_ENDPOINTS[provider]?.requiresApiKey !== false && provider !== "ollama");

  const ignoreInvalidKey = args["ignore-invalid-key"] || args["ignore-error"] || config.ignoreInvalidKey === true;

  if (!apiKey && requiresApiKey) {
    console.log(
      `\n[CharacterGraph] No API key found for provider "${provider}". Prompt file created; skipping LLM call.`,
    );
    return;
  }
  const configModel = configMatchesProvider ? config.model : undefined;

  let responseText: string;
  try {
    if (provider === "gemini") {
      const model = args.model || configModel || "gemini-3.5-flash";
      console.log(`\nCalling Gemini (${model})...`);
      responseText = (await callGemini({ apiKey: apiKey as string, model, system: prompt.system, user: prompt.user })).text;
    } else if (provider === "claude") {
      const model = args.model || configModel || "claude-sonnet-5";
      console.log(`\nCalling Claude (${model})...`);
      responseText = (await callClaude({ apiKey: apiKey as string, model, system: prompt.system, user: prompt.user, endpoint: args.url })).text;
    } else {
      const known = KNOWN_PROVIDER_ENDPOINTS[provider];
      const endpoint = args.url || known?.endpoint;
      if (!endpoint) {
        console.error(`Unknown provider "${provider}" and no --url given. Known providers: gemini, claude, ${Object.keys(KNOWN_PROVIDER_ENDPOINTS).join(", ")}.`);
        process.exit(2);
      }
      const model = args.model || configModel || known?.defaultModel;
      if (!model) {
        console.error(`--model is required for provider "${provider}" (no known default for custom --url).`);
        process.exit(2);
      }
      console.log(`\nCalling ${provider} (${model}) at ${endpoint}...`);
      responseText = (await callOpenAICompat({ endpoint, apiKey, model, system: prompt.system, user: prompt.user, extraHeaders: known?.extraHeaders })).text;
    }
  } catch (error) {
    const errMessage = (error as Error).message || String(error);
    const isAuthOrNetworkError = /401|403|unauthorized|forbidden|api key|invalid|auth/i.test(errMessage);
    if (ignoreInvalidKey || isAuthOrNetworkError) {
      console.warn(`\n[CharacterGraph] Warning: LLM call failed (${errMessage}). Skipping graph extraction gracefully.`);
      return;
    }
    console.error(`\n[CharacterGraph] Error executing LLM call: ${errMessage}`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    const badFile = join(outDir, `${base}.character-graph.invalid.txt`);
    writeFileSync(badFile, responseText, "utf8");
    if (ignoreInvalidKey) {
      console.warn(`\n[CharacterGraph] LLM response wasn't valid JSON. Raw response written to: ${badFile}. Skipping graph gracefully.`);
      return;
    }
    console.error(`LLM response wasn't valid JSON — raw response written to:\n  ${badFile}`);
    process.exit(1);
  }

  try {
    validateCharacterGraph(parsed);
  } catch (error) {
    const badFile = join(outDir, `${base}.character-graph.invalid.json`);
    writeFileSync(badFile, JSON.stringify(parsed, null, 2), "utf8");
    if (ignoreInvalidKey) {
      console.warn(`\n[CharacterGraph] LLM JSON didn't match CharacterGraph shape: ${(error as Error).message}. Raw output written to: ${badFile}. Skipping graph gracefully.`);
      return;
    }
    console.error(`LLM JSON doesn't match the CharacterGraph shape: ${(error as Error).message}\nRaw output written to:\n  ${badFile}`);
    process.exit(1);
  }

  const graphFile = join(outDir, `${base}.character-graph.json`);
  writeFileSync(graphFile, JSON.stringify(parsed, null, 2), "utf8");
  const graph = parsed as { characters: unknown[]; formsOfAddress: unknown[] };
  console.log(`\nWrote graph (${graph.characters.length} character(s), ${graph.formsOfAddress.length} forms-of-address) to:\n  ${graphFile}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
