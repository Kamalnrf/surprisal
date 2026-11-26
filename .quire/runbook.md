# Quire runbook

Surprisal is a single-page writing editor that heatmaps how predictable each word and sentence is
to an LLM.

## Environments and access

### Production (https://surprisal.ink)

- The only environment. Deploy on push to main updates it; there are no previews or staging.
- There is no sign-in. Writing lives in the browser's IndexedDB, so a fresh browser starts empty
  and Quire may type anything there.
- Scoring calls a paid GPU and shares a daily allowance (1500 calls, at least 250 ms apart)
  with real visitors. Keep paragraphs short and don't type in a way that rescores repeatedly.
- "Surprisal has used today's allowance" or "Too many requests" means the allowance ran out or
  the requests came too fast: report the check as blocked, not failed.

## Verification paths

### Write and score

- Open the site, finish or skip onboarding, then type a short paragraph of two or three
  sentences.
- Success: the word count updates; after a pause, the Surprisal panel lists each sentence as
  expected, half-expected or unexpected; clicking a warm word shows what the model expected.
- Reload the page: the text is still there.

## Trusted checks

- `bun run check` typechecks the frontend, Worker and shared code.

## Project-specific exceptions

- Don't test `@rules` or Observations: they need a Jev API key, and Quire has no way to enter
  one into the key field.
