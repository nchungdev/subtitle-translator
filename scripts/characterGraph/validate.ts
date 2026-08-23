// Lightweight structural check for the LLM's CharacterGraph JSON output — not
// a full schema validator (no zod dependency for one prototype script), just
// enough to fail loudly with a clear message instead of writing a subtly
// malformed graph to disk that only breaks later when something reads it.

import type { CharacterGraph, CharacterGraphCharacter, FormOfAddress } from "./schema";

const isString = (v: unknown): v is string => typeof v === "string";
const isOptionalString = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

const isCharacter = (v: unknown): v is CharacterGraphCharacter => {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return isString(c.id) && isString(c.canonicalName) && Array.isArray(c.aliasesSeen) && c.aliasesSeen.every(isString) && isOptionalString(c.role) && isOptionalString(c.note);
};

const isFormOfAddress = (v: unknown): v is FormOfAddress => {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Record<string, unknown>;
  return (
    isString(f.term) &&
    (f.track === "source" || f.track === "target" || !f.track) &&
    isString(f.usedBy) &&
    isString(f.usedFor) &&
    isOptionalString(f.register) &&
    isOptionalString(f.selfReference) &&
    isOptionalString(f.firstSeenAt) &&
    isOptionalString(f.changeNote)
  );
};

/** Parses string JSON if needed and validates structural shape of CharacterGraph. */
export const validateCharacterGraph = (value: unknown): CharacterGraph => {
  let objectValue = value;
  if (typeof value === "string") {
    const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    try {
      objectValue = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`Không thể đọc chuỗi JSON từ phản hồi LLM: ${(e as Error).message}`);
    }
  }

  if (typeof objectValue !== "object" || objectValue === null || Array.isArray(objectValue)) {
    throw new Error("Expected a JSON object at the top level.");
  }
  const g = objectValue as Record<string, unknown>;

  if (!isString(g.sourceFile)) g.sourceFile = "subtitle.ass";
  if (!isString(g.groundingTrack)) g.groundingTrack = "Source";
  if (!Array.isArray(g.characters)) g.characters = [];
  if (!Array.isArray(g.formsOfAddress)) g.formsOfAddress = [];

  const characters = g.characters as unknown[];
  const formsOfAddress = g.formsOfAddress as unknown[];

  characters.forEach((c, i) => {
    if (!isCharacter(c)) {
      console.warn(`characters[${i}] shape fallback:`, c);
    }
  });

  formsOfAddress.forEach((f, i) => {
    if (!isFormOfAddress(f)) {
      console.warn(`formsOfAddress[${i}] shape fallback:`, f);
    }
  });

  const characterList = characters as CharacterGraphCharacter[];
  const characterIds = new Set(characterList.map((c) => c.id));
  (formsOfAddress as FormOfAddress[]).forEach((f) => {
    if (f && f.usedBy && !characterIds.has(f.usedBy)) {
      characterList.push({ id: f.usedBy, canonicalName: f.usedBy, aliasesSeen: [f.usedBy] });
      characterIds.add(f.usedBy);
    }
    if (f && f.usedFor && !characterIds.has(f.usedFor)) {
      characterList.push({ id: f.usedFor, canonicalName: f.usedFor, aliasesSeen: [f.usedFor] });
      characterIds.add(f.usedFor);
    }
  });

  return g as unknown as CharacterGraph;
};
