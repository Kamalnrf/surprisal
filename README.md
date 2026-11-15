# Surprisal

Surprisal shows where your writing is most predictable for an LLM, as a
heatmap. It never writes for you.

It is deeply inspired by the writing machine in Italo Calvino's Cybernetics and
Ghosts. When you know the rules, regulations and expectations you're meeting,
you can think to write differently. LLMs make most writing average, Surprisal
pushes away from it.

The model is Qwen3 4B Base, hosted on Modal.

Try it at https://surprisal.val.run

## How it works

- **Heatmap.** Warm words are ones the model would have written itself.
  Underlines are phrases it would write exactly. Each sentence is rated
  expected, half-expected or unexpected.
- **Rules.** Write rules as plain sentences anywhere on the page with
  `@rules - a rule`. We pass each paragraph to Jev and leave observations when
  rules are broken. Rules need a Jev key, Surprisal works without one.
- **One page.** Jef Raskin's Canon Cat and iA Writer are our inspirations for
  the editor. Your writing and rules are all on one page, with Markdown,
  sections, Leap and variants.

Your writing is saved in your browser, not synced. Surprisal sends the current
and previous paragraph to the model, and rules send nearby writing to Jev.

## Run your own

1. Remix this Val on Val Town.
2. Run `setup.ts` once. It creates the database and prints a `PUBLIC_KEY`.
3. Paste that key into `scorer.py` and run `modal deploy scorer.py` (needs a
   Modal account).
4. Set the Val's `SCORER_URL` environment variable to the URL Modal prints.

## Code

- `frontend/` the editor, in React and CodeMirror
- `backend/` the Val's API: `/api/surprisal` and `/api/annotate`
- `shared/` parsing and scoring used by both
- `scorer.py` the Modal app that runs the model (`modal deploy scorer.py`)

```sh
deno task check
deno task test
```
