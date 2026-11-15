"""Raw, prefix-conditioned Qwen surprisal. Deploy with `modal deploy scorer.py`."""
import base64
import json
import time

import modal

MODEL = "Qwen/Qwen3-4B-Base"
REVISION = "906bfd4b4dc7f14ee4320094d8b41684abff8539"
# Public verification keys only. The signing key lives in Alchemy's state
# (alchemy.run.ts prints scorerPublicKey). The first key is the old Val Town
# app's; drop it once surprisal.val.run is gone.
PUBLIC_KEYS = [
    "x8TbzZb5PYPLXCOPttLsEQUkjfVi87ExdG2X2vRFwfU",
    "lhrojr4GeMcf-0hNTKqZO5d8eJZNci0LjnVF1VqksKk",
]
# How many of the model's guesses to return for each token.
GUESSES = 5
app = modal.App("surprisal-scorer")
weights = modal.Volume.from_name("surprisal-weights", create_if_missing=True)
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch==2.6.0", "transformers==4.51.3", "fastapi[standard]", "cryptography"
).env({"HF_HOME": "/weights", "HF_HUB_DISABLE_PROGRESS_BARS": "1"})


def utf16_offsets(text):
    """Code-point index -> UTF-16 index, for offsets the browser can use."""
    offsets = [0]
    for char in text:
        offsets.append(offsets[-1] + len(char.encode("utf-16-le")) // 2)
    return offsets


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
        weights.commit()

    @modal.method()
    def surprisal(self, text: str):
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
            values, indices = logp.topk(GUESSES, dim=-1)
            values, indices = values.tolist(), indices.tolist()
        utf16 = utf16_offsets(text)
        tokens = [{"start": utf16[start], "end": utf16[end], "logprob": actual[i],
                   "rank": ranks[i],
                   # What the model expected here instead, most likely first.
                   "guesses": [{"text": self.tokenizer.decode([t]), "logprob": v}
                               for t, v in zip(indices[i], values[i])]}
                  for i, (start, end) in enumerate(offsets)]
        return {"tokens": tokens, "model": MODEL, "revision": REVISION,
                "ms": round((time.perf_counter() - started) * 1000)}


@app.function(image=modal.Image.debian_slim().pip_install("fastapi[standard]", "cryptography"),
              max_containers=1, timeout=240, scaledown_window=120)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    server = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    keys = [Ed25519PublicKey.from_public_bytes(base64.urlsafe_b64decode(k + "="))
            for k in PUBLIC_KEYS]
    used = {}

    def verifies(key, signature, raw):
        try:
            key.verify(signature, raw)
            return True
        except Exception:
            return False

    @server.post("/surprisal")
    async def surprisal(request: Request):
        raw = await request.body()
        if len(raw) > 25000:
            return JSONResponse({"error": "Request too large"}, 413)
        try:
            signature = base64.b64decode(request.headers.get("x-signature", ""))
            if not any(verifies(key, signature, raw) for key in keys):
                raise ValueError("bad signature")
            data = json.loads(raw)
            if abs(time.time() - data["timestamp"]) > 60:
                raise ValueError("expired")
            text = data["text"]
            if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                raise ValueError("invalid text")
            nonce = data["nonce"]
            if not isinstance(nonce, str) or nonce in used:
                raise ValueError("replay")
        except Exception:
            return JSONResponse({"error": "Unauthorized or invalid request"}, 401)
        now = time.time()
        for old in [n for n, stamp in used.items() if now - stamp > 120]:
            del used[old]
        used[nonce] = now
        result = await Scorer().surprisal.remote.aio(text)
        return JSONResponse(result, 422 if "error" in result else 200)

    @server.get("/health")
    def health():
        return {"ok": True, "model": MODEL, "revision": REVISION}
    return server
