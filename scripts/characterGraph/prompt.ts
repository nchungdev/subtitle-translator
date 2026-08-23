// Builds the extraction prompt fed to an LLM to produce a CharacterGraph
// (see schema.ts) for one subtitle file. Kept separate from the API-calling
// code so the prompt itself can be reviewed/iterated on without touching
// any network code — this repo is still in the "validate the prompt design"
// phase, not wired to a live call yet.

export interface DialogueLine {
  /** Subtitle timecode as it appears in the file (HH:MM:SS.ss), used for firstSeenAt + cross-track correlation. */
  time: string;
  text: string;
}

export interface CharacterGraphPromptInput {
  sourceFileName: string;
  /** Label for the grounding track, e.g. "JP" — the style name as it appears in the ASS file. */
  groundingTrackLabel: string;
  groundingLines: DialogueLine[];
  /** Other track(s) present in the same file, shown for cross-reference only — never overrides the grounding track for identity/register judgments. */
  otherTracks: { label: string; lines: DialogueLine[] }[];
}

const formatLines = (lines: DialogueLine[]): string => lines.map((l) => `[${l.time}] ${l.text}`).join("\n");

const SCHEMA_DESCRIPTION = `type CharacterGraph = {
  sourceFile: string;
  groundingTrack: string;
  characters: {
    id: string;                // stable slug, e.g. "kindaichi"
    canonicalName: string;     // best "true" identity name, grounded in the source-language track
    aliasesSeen: string[];     // every literal term seen anywhere referring to this person, any track
    role?: string;             // short job/role label if the dialogue makes it evident, e.g. "police detective"
    note?: string;             // optional one-line disambiguation
  }[];
  formsOfAddress: {
    term: string;              // literal text as it appears in the line(s)
    track: "source" | "target";
    usedBy: string;            // character id speaking/referring
    usedFor: string;           // character id being addressed/referred to
    register: string;          // short label, 2-4 words, e.g. "intimate", "polite-stranger", "formal-title",
                                // "casual-familiar", "hierarchical-senior", "hierarchical-junior", "hostile-neutral"
    selfReference?: string;    // how usedBy refers to THEMSELF (1st person) when speaking to usedFor — see SELF-REFERENCE RULE
    firstSeenAt: string;       // timecode of the first line using this term for this pair
    changeNote?: string;       // only if this term REPLACES an earlier one for the same pair — what changed and why
  }[];
};`;

export const buildCharacterGraphPrompt = (input: CharacterGraphPromptInput): { system: string; user: string } => {
  const system = `You are an expert script analyst preparing a naming/relationship reference sheet for professional subtitle localization.

GOAL (this is the actual point of the exercise, not a nice-to-have): a translator working line-by-line, one line at a time, with NO memory of earlier lines, must still be able to look up "speaker=X, addressee=Y, current time=T" in your output and get back the ONE correct term to use — consistently, every time the same identity is meant, no matter how many different literal words the original script used for that identity. You are building IDENTITY-consistent reference data, not a flat term-by-term glossary — the same identity may legitimately be called several different things by the same speaker (a nickname AND a formal name), and your job is to capture WHEN each applies, not to pick just one.

GROUNDING RULE: the "source" track is whichever track is actually being translated in this job — not necessarily the work's original language. (A bilingual file translated per-track, each to its own target, needs a separate run of this exercise per track — never assume one track is grounding for a job that isn't translating from it.) When the "target" track (another existing track in the same file, shown for reference only) disagrees with what the source track implies — different register, a name dropped or added — trust the source track for identity and register judgments. Use the target track only as supporting evidence of how a professional translator already chose to localize something (useful context, not authoritative).

PRUNE RULE: only include a character in "characters" if they appear in at least one formsOfAddress entry, either as usedBy or usedFor. A character who is only narrated about, or only mentioned by name with no other character directly addressing or being addressed by them, should be left out entirely.

CHANGE-TRACKING RULE: when the same (usedBy, usedFor) pair uses more than one term across the episode, this is often not noise — it can be a deliberate character moment (a relationship shift, a negotiation, a slip of formality). Output ALL distinct terms that pair uses, each as its own formsOfAddress entry with its own firstSeenAt, and set changeNote on every entry after the first explaining what triggered the change if the dialogue makes that explicit (quote or paraphrase the line that shows it). If the dialogue doesn't explain a change, leave changeNote unset rather than guessing.

SELF-REFERENCE RULE: many target languages use reciprocal pronoun pairs, not a single fixed "you" (Vietnamese anh↔em, chị↔em, tớ↔cậu, and others) — the term usedBy calls usedFor and the term usedBy calls THEMSELF when speaking to usedFor are two halves of one pair, and a translation can get one half right while silently breaking the other (addressee called respectfully while the speaker keeps a casual self-reference, or vice versa). Set selfReference whenever the relationship/register implies a specific pairing, even if the source track doesn't mark first person explicitly — infer it from the same register you already assigned to "term", don't leave it unset just because the source is silent about it.

Output ONLY a JSON object matching this TypeScript type — no markdown fences, no commentary before or after:

${SCHEMA_DESCRIPTION}`;

  const otherTracksBlock = input.otherTracks
    .map((t) => `--- ${t.label} track (target / reference only) ---\n${formatLines(t.lines)}`)
    .join("\n\n");

  const user = `File: ${input.sourceFileName}
Grounding track: ${input.groundingTrackLabel}

--- ${input.groundingTrackLabel} track (source / grounding) ---
${formatLines(input.groundingLines)}

${otherTracksBlock}`;

  return { system, user };
};
