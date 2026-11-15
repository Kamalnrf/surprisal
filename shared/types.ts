export interface Rule {
  id: string;
  instruction: string;
}
export interface Context {
  before: string;
  after: string;
}
export interface AnalysisInput {
  paragraph: string;
  context: Context;
  rules: Rule[];
}
export interface Paragraph {
  start: number;
  end: number;
  text: string;
}
export interface Section extends Paragraph {
  index: number;
  tag: string;
}
export interface ParagraphFocus extends Paragraph {
  index: number;
  context: Context;
}
export interface Focus extends ParagraphFocus {
  section: Section;
  excluded: boolean;
}
export interface Sentence extends Paragraph {
  id: number;
}
export interface Observation {
  ruleId: string;
  sentenceId: number;
  quote: string;
  start: number;
  end: number;
}
// shown: selected as the rule's observation. eligible: at or above the
// threshold, but an earlier sentence was shown for the rule. unanswered: Jev
// returned no valid score, so the run failed and no finding was accepted.
export type AnswerOutcome = "shown" | "eligible" | "below" | "unanswered";
export interface JevAnswer {
  name: string;
  ruleId: string;
  sentenceId: number;
  // Exact instructions sent to Jev for this rule × sentence question.
  instructions: string;
  score: number | null;
  outcome: AnswerOutcome;
}
// Captured from the executed request. Never contains the caller's key.
export interface Diagnostics {
  requestedModel: string;
  threshold: number;
  rules: Rule[];
  state: { paragraph: string; sentences: Sentence[]; context: Context };
  answers: JevAnswer[];
}
export interface AnalysisResult {
  observations: Observation[];
  model: string | null;
  version: string;
  diagnostics: Diagnostics;
}
export interface AnalysisErrorBody {
  error: string;
  diagnostics?: Diagnostics;
}
export interface SurprisalToken {
  start: number;
  end: number;
  logprob: number;
  rank: number;
  // The model's top guesses for this token, most likely first.
  guesses: { text: string; logprob: number }[];
}
export interface SurprisalResult {
  tokens: SurprisalToken[];
  model: string;
  ms: number;
}
