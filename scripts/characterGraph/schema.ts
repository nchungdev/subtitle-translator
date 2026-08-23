// Character naming/relationship graph — per-file extraction schema.
//
// Design goal (stated priority, not a nice-to-have): the graph must let a
// downstream translator answer "given speaker=S, addressee=A, at time=T,
// what's the ONE correct term to use" — i.e. IDENTITY-consistent naming, not
// TERM-consistent glossary matching. A flat Glossary (source→target) can't
// express "阿一 and 金田一君 refer to the same person" or "this pair's term
// changes mid-episode by negotiation" — this schema exists specifically to
// carry that information forward into translation.
//
// Scope: one graph per subtitle FILE (episode), not per season. Season-wide
// continuity for recurring characters is a later merge step over multiple
// per-file graphs (each graph keeps `sourceFile` for that reason) — out of
// scope for this prototype.

export interface CharacterGraphCharacter {
  /** Stable slug used to reference this character from formsOfAddress entries. */
  id: string;
  /**
   * The character's "true" identity name — prefer the grounding-language
   * track (see CharacterGraph.groundingTrack) over a translated track, since
   * the translated track is itself already one interpretive choice.
   */
  canonicalName: string;
  /** Every literal term seen anywhere in the script referring to this person, across all tracks/languages. */
  aliasesSeen: string[];
  /**
   * Short job/role label if the dialogue makes it evident (e.g. "police detective",
   * "event promoter", "high school student") — not the point of the graph, but cheap
   * to capture and useful both as register justification (why a pair defaults to a
   * formal/hierarchical register) and as a human-readable anchor for the eventual
   * per-file preview/edit UI. Omit if the script never makes it clear.
   */
  role?: string;
  /** One-line disambiguation if useful (relationship to the plot beyond role), not required. */
  note?: string;
}

export type AddressRegister =
  | "intimate" // childhood friends, close nickname use
  | "polite-stranger" // first meeting, honorific distance
  | "formal-title" // Mr./Ms./professional title
  | "casual-familiar" // adult-to-adult familiar but not intimate (nicknames like 老陈/小新)
  | "hierarchical-senior" // junior→senior (senpai/kouhai, teacher/student)
  | "hierarchical-junior" // senior→junior
  | "hostile-neutral" // strangers, no relationship established
  | string; // extraction may propose a more specific label; keep it short (2-4 words)

export interface FormOfAddress {
  /** The literal text as it appears in the source line(s). */
  term: string;
  /** Which track this literal term was read from — "source" = groundingTrack, "target" = the other track, if both are present. */
  track: "source" | "target";
  /** Character id doing the addressing/referring. */
  usedBy: string;
  /** Character id being addressed or referred to. */
  usedFor: string;
  register: AddressRegister;
  /**
   * How `usedBy` refers to THEMSELF (first person) when speaking to `usedFor` —
   * not always inferable from the source track (JP doesn't always mark this
   * explicitly either), but critical for target languages with reciprocal
   * pronoun pairs (Vietnamese anh↔em, chị↔em, tớ↔cậu, etc.): tracking only
   * "what A calls B" lets a translator produce a mismatched pair — B addressed
   * respectfully as "anh" while A still self-refers as the casual "tớ" — even
   * though each half looks locally fine in isolation. Ground it in the source
   * track's own first-person marker when the language has one (JP 僕/俺/私 carry
   * real register information); when the source doesn't mark it, infer from the
   * register/relationship already established by `term` rather than leaving it
   * unset by default.
   */
  selfReference?: string;
  /**
   * Timestamp (HH:MM:SS.ss, matching the subtitle file's own timecodes) of the
   * first line where this term is used for this (usedBy, usedFor) pair. Lets a
   * translator resolve which term is "current" at a given point in the episode
   * when a pair uses more than one term over the course of it.
   */
  firstSeenAt: string;
  /**
   * If this term REPLACES an earlier one for the same pair (a naming
   * negotiation, a relationship shift), name what changed and why in one
   * short clause — e.g. "Kindaichi asks her to stop using -kun, switch to
   * given name". Omit for a pair's only/first term.
   */
  changeNote?: string;
}

export interface CharacterGraph {
  sourceFile: string;
  /**
   * Which style/track was treated as ground truth for identity + register judgments.
   * NOT necessarily the work's original language — it's whichever track is the actual
   * SOURCE of the translation job this graph is built for. A bilingual file translated
   * independently per track (JP→X, CN→Y) needs one graph PER track, each grounded on
   * its own track; don't build one shared graph and assume JP is grounding for a CN→Y
   * job just because JP happens to be the original-language track in the file.
   */
  groundingTrack: string;
  characters: CharacterGraphCharacter[];
  /**
   * Flat list, not nested per-pair — easier for the extraction step to emit
   * incrementally and easier to filter/query. Reconstruct a per-pair view by
   * grouping on (usedBy, usedFor). A character with zero formsOfAddress
   * entries either as usedBy or usedFor should not appear in `characters` —
   * that's the "prune non-interacting characters" rule.
   */
  formsOfAddress: FormOfAddress[];
}
