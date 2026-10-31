"""Raw, prefix-conditioned Qwen scoring. Deploy with `modal deploy scorer.py`."""
import base64
import json
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


@app.cls(image=image, gpu="L4", cpu=1, memory=16384,
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
    def score(self, text: str):
        torch = self.torch
        started = time.perf_counter()
        encoded = self.tokenizer(text, return_offsets_mapping=True, add_special_tokens=False)
        ids, offsets = encoded["input_ids"], encoded["offset_mapping"]
        if len(ids) > 1024:
            return {"error": "This experiment accepts at most 1,024 model tokens."}
        if not ids:
            return {"tokens": [], "model": MODEL, "revision": REVISION, "ms": 0}
        # Qwen has no dedicated BOS. EOS supplies an explicit, fixed document boundary.
        prefix = self.tokenizer.eos_token_id
        inputs = torch.tensor([[prefix] + ids], device="cuda")
        with torch.inference_mode():
            logits = self.model(inputs).logits[0, :-1].float()
            logp = logits.log_softmax(-1)
            actual = logp.gather(1, torch.tensor(ids, device="cuda")[:, None]).squeeze(1)
            values, indices = logp.topk(5, dim=-1)
            ranks = (logits > logits.gather(1, torch.tensor(ids, device="cuda")[:, None])).sum(-1) + 1
            actual, values, indices, ranks = actual.tolist(), values.tolist(), indices.tolist(), ranks.tolist()
            # A short greedy continuation, not an instruction-following rewrite.
            continuation = self.model.generate(
                inputs, attention_mask=torch.ones_like(inputs), max_new_tokens=8,
                do_sample=False, pad_token_id=prefix,
            )[0, inputs.shape[1]:].tolist()
        # Browser offsets use UTF-16, Python/tokenizer offsets use Unicode code points.
        utf16 = [0]
        for char in text:
            utf16.append(utf16[-1] + len(char.encode("utf-16-le")) // 2)
        tokens = []
        for i, (start, end) in enumerate(offsets):
            tokens.append({
                "id": ids[i], "start": utf16[start], "end": utf16[end],
                "logprob": actual[i], "rank": ranks[i],
                "top": [{"id": tid, "text": self.tokenizer.decode([tid]), "logprob": lp}
                        for tid, lp in zip(indices[i], values[i])],
            })
        return {"tokens": tokens, "model": MODEL, "revision": REVISION,
                "continuation": self.tokenizer.decode(continuation, skip_special_tokens=True),
                "boundary": "eos", "ms": round((time.perf_counter() - started) * 1000)}


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

    @server.post("/score")
    async def score(request: Request):
        raw = await request.body()
        if len(raw) > 25000:
            return JSONResponse({"error": "Request too large"}, 413)
        try:
            key.verify(base64.b64decode(request.headers.get("x-signature", "")), raw)
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
        result = await Scorer().score.remote.aio(text)
        return JSONResponse(result, 422 if "error" in result else 200)

    @server.get("/health")
    def health():
        return {"ok": True, "model": MODEL, "revision": REVISION}
    return server
