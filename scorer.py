"""Raw, prefix-conditioned Qwen surprisal and forks. Deploy with `modal deploy scorer.py`."""
import base64
import json
import re
import time

import modal

MODEL = "Qwen/Qwen3-4B-Base"
REVISION = "906bfd4b4dc7f14ee4320094d8b41684abff8539"
# Public verification key only. The signing key stays in Val Town's database.
PUBLIC_KEY = "x8TbzZb5PYPLXCOPttLsEQUkjfVi87ExdG2X2vRFwfU"
app = modal.App("surprisal-scorer")
weights = modal.Volume.from_name("surprisal-weights", create_if_missing=True)
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch==2.6.0", "transformers==4.51.3", "fastapi[standard]", "cryptography"
).env({"HF_HOME": "/weights", "HF_HUB_DISABLE_PROGRESS_BARS": "1"})

# Words that carry grammar rather than a writer's choice. A fork that only
# swaps "the" for "a" is not a different direction.
FUNCTION_WORDS = set("""
a an the and or but nor so yet for of in on at to from by with without into onto
over under about above below after before as than then that this these those
there here it its it's is was were be been being am are has have had do does did
not no i me my we us our you your he him his she her they them their what which
who whom whose when where why how all any some each every more most much many
very just also too can could will would shall should may might must if
""".split())
FORKS = 3
FORK_TOKENS = 8
CANDIDATES = 400


def utf16_offsets(text):
    """Code-point index -> UTF-16 index, for offsets the browser can use."""
    offsets = [0]
    for char in text:
        offsets.append(offsets[-1] + len(char.encode("utf-16-le")) // 2)
    return offsets


def code_point_index(text, utf16_index):
    for i, offset in enumerate(utf16_offsets(text)):
        if offset >= utf16_index:
            return i
    return len(text)


def clip(continuation):
    """Keep a fork to its first line and whole words."""
    line = continuation.split("\n", 1)[0]
    if len(line) < len(continuation) or re.search(r"[\w’']$", line) is None:
        return line.rstrip()
    # Generation stopped mid-word: drop the partial word.
    return re.sub(r"\s*\S*$", "", line) or line


# A10G is a fallback for when Modal has no L4 free; the model fits either.
@app.cls(image=image, gpu=["L4", "A10G"], cpu=1, memory=16384,
         volumes={"/weights": weights}, max_containers=1, min_containers=0,
         scaledown_window=120, timeout=60, startup_timeout=600)
class Scorer:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION)
        self.model = AutoModelForCausalLM.from_pretrained(
            MODEL, revision=REVISION, torch_dtype=torch.bfloat16,
            attn_implementation="sdpa",
        ).to("cuda").eval()
        # Which vocabulary entries begin a new, alphabetic, non-function word.
        self.word_start = [
            piece.startswith(" ") and len(piece) >= 4 and piece[1:].isalpha()
            and piece[1:].lower() not in FUNCTION_WORDS
            for piece in self.tokenizer.batch_decode([[i] for i in range(len(self.tokenizer))])
        ]
        weights.commit()

    def generate(self, inputs, tokens):
        torch = self.torch
        prefix = self.tokenizer.eos_token_id
        out = self.model.generate(
            inputs, attention_mask=torch.ones_like(inputs), max_new_tokens=tokens,
            do_sample=False, pad_token_id=prefix,
        )[:, inputs.shape[1]:]
        return [self.tokenizer.decode(row, skip_special_tokens=True) for row in out.tolist()]

    def fork(self, text, cursor):
        """What the model expects at `cursor`, and the least expected words it still finds plausible."""
        torch = self.torch
        # A caret inside a word forks after that word, not from a fragment of it.
        while 0 < cursor < len(text) and text[cursor].isalnum() and text[cursor - 1].isalnum():
            cursor += 1
        # Fork from the end of the last word so candidates carry their own leading space.
        prefix_text = text[:cursor].rstrip()
        if not prefix_text:
            return None
        ids = self.tokenizer(prefix_text, add_special_tokens=False)["input_ids"][-1024:]
        inputs = torch.tensor([[self.tokenizer.eos_token_id] + ids], device="cuda")
        with torch.inference_mode():
            logp = self.model(inputs).logits[0, -1].float().log_softmax(-1)
            values, indices = logp.topk(CANDIDATES)
            probs = values.exp().tolist()
            indices = indices.tolist()
            # The obvious set is whatever covers the first half of the probability mass.
            mass, obvious = 0.0, 0
            while obvious < len(probs) and (mass < 0.5 or obvious < 3):
                mass += probs[obvious]
                obvious += 1
            # Plausible: at least 1% as likely as the model's first choice.
            floor = probs[0] * 0.01
            seen, candidates = set(), []
            for rank in range(obvious, len(indices)):
                if probs[rank] < floor:
                    break
                if not self.word_start[indices[rank]]:
                    continue
                word = self.tokenizer.decode([indices[rank]]).strip().lower()
                if any(word.startswith(s[:4]) or s.startswith(word[:4]) for s in seen):
                    continue
                seen.add(word)
                candidates.append((rank, indices[rank], probs[rank]))
            # Spread the picks from the edge of plausibility inward.
            picks = candidates[::-1][:: max(1, len(candidates) // FORKS)][:FORKS]
            expected = self.generate(inputs, FORK_TOKENS)[0]
            forks = []
            if picks:
                batch = torch.cat([inputs.repeat(len(picks), 1),
                                   torch.tensor([[p[1]] for p in picks], device="cuda")], 1)
                tails = self.generate(batch, FORK_TOKENS - 1)
                for (rank, token_id, p), tail in zip(picks, tails):
                    forks.append({"text": clip(self.tokenizer.decode([token_id]) + tail),
                                  "rank": rank + 1, "p": p})
        utf16 = utf16_offsets(text)
        return {"at": utf16[len(prefix_text)], "expected": clip(expected),
                "forks": sorted(forks, key=lambda f: f["rank"])}

    @modal.method()
    def surprisal(self, text: str, cursor: int | None):
        torch = self.torch
        started = time.perf_counter()
        encoded = self.tokenizer(text, return_offsets_mapping=True, add_special_tokens=False)
        ids, offsets = encoded["input_ids"], encoded["offset_mapping"]
        if len(ids) > 1024:
            return {"error": "Surprisal reads at most 1,024 model tokens at a time."}
        # Qwen has no dedicated BOS. EOS supplies an explicit, fixed document boundary.
        inputs = torch.tensor([[self.tokenizer.eos_token_id] + ids], device="cuda")
        target = torch.tensor(ids, device="cuda")[:, None]
        with torch.inference_mode():
            logits = self.model(inputs).logits[0, :-1].float()
            logp = logits.log_softmax(-1)
            actual = logp.gather(1, target).squeeze(1).tolist()
            ranks = ((logits > logits.gather(1, target)).sum(-1) + 1).tolist()
            entropy = (-(logp.exp() * logp).sum(-1)).tolist()
        utf16 = utf16_offsets(text)
        tokens = [{"start": utf16[start], "end": utf16[end], "logprob": actual[i],
                   "rank": ranks[i], "entropy": entropy[i]}
                  for i, (start, end) in enumerate(offsets)]
        fork = None if cursor is None else self.fork(text, code_point_index(text, cursor))
        return {"tokens": tokens, "fork": fork, "model": MODEL, "revision": REVISION,
                "ms": round((time.perf_counter() - started) * 1000)}


@app.function(image=modal.Image.debian_slim().pip_install("fastapi[standard]", "cryptography"),
              max_containers=1, timeout=240, scaledown_window=120)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    server = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    key = Ed25519PublicKey.from_public_bytes(base64.urlsafe_b64decode(PUBLIC_KEY + "="))
    used = {}

    @server.post("/surprisal")
    async def surprisal(request: Request):
        raw = await request.body()
        if len(raw) > 25000:
            return JSONResponse({"error": "Request too large"}, 413)
        try:
            key.verify(base64.b64decode(request.headers.get("x-signature", "")), raw)
            data = json.loads(raw)
            if abs(time.time() - data["timestamp"]) > 60:
                raise ValueError("expired")
            text, cursor = data["text"], data.get("cursor")
            if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                raise ValueError("invalid text")
            if cursor is not None and (not isinstance(cursor, int) or not 0 <= cursor <= len(text) * 2):
                raise ValueError("invalid cursor")
            nonce = data["nonce"]
            if not isinstance(nonce, str) or nonce in used:
                raise ValueError("replay")
        except Exception:
            return JSONResponse({"error": "Unauthorized or invalid request"}, 401)
        now = time.time()
        for old in [n for n, stamp in used.items() if now - stamp > 120]:
            del used[old]
        used[nonce] = now
        result = await Scorer().surprisal.remote.aio(text, cursor)
        return JSONResponse(result, 422 if "error" in result else 200)

    @server.get("/health")
    def health():
        return {"ok": True, "model": MODEL, "revision": REVISION}
    return server
