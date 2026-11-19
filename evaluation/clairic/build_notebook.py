"""Builds clairic_flash_synthetic_cards.ipynb (run: python3 build_notebook.py).

The notebook runs Cloudflare Clairic Flash (9B, Apache-2.0) on Hathor's 14
synthetic vaccination cards and scores it against manifest.json. Synthetic
cards only: no real child record ever goes into Colab.
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
cells = []


def md(s):
    cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})


def code(s):
    cells.append({"cell_type": "code", "metadata": {}, "execution_count": None,
                  "outputs": [], "source": s.strip("\n")})


md("""
# Clairic Flash on Hathor's synthetic vaccination cards

**Question:** when Clairic Flash gives a field low confidence, is that field actually wrong?
If yes, its per-field confidence can decide what goes to Hathor's human review queue.

- Model: [`Cloudflare/clairic-flash`](https://huggingface.co/Cloudflare/clairic-flash) (9B, Apache-2.0).
- Data: the 14 synthetic cards in `cards/fixtures/synthetic_vaccination_cards/`. They hold fictional children and invented dates, and the expected answers are in `manifest.json`.
- **Never upload a real card to this notebook.**
- Runtime: **H100 if offered, else A100** (Runtime → Change runtime type). A T4 won't work. On an A100, cell 4 sends DeepGEMM's Hopper-only matmul to the model's Triton fallback and prints `PATCHED`.
- Run order: **Runtime → Run all**. The install cell restarts the session once; after that, choose **Run all** again.
""")

code(r"""
# 1. GPU check: stop early instead of downloading 10 GB onto the wrong machine
import subprocess, torch
print(subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv"], capture_output=True, text=True).stdout)
assert torch.cuda.is_available(), "No GPU. Runtime -> Change runtime type -> A100."
cap = torch.cuda.get_device_capability(0)
mem_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
print(f"compute capability {cap}, {mem_gb:.0f} GB")
assert cap >= (8, 0) and mem_gb >= 22, "Need an A100 or H100 (>= 22 GB, compute 8.0+)."
""")

code(r"""
# 2. Get the synthetic cards (public Hathor repo) and the model files
import os, pathlib
if not pathlib.Path("/content/hathor").exists():
    !git clone --depth 1 https://github.com/DrAhmed7887/hathor.git /content/hathor
from huggingface_hub import snapshot_download
MODEL_DIR = snapshot_download("Cloudflare/clairic-flash")
print(MODEL_DIR)
""")

code(r"""
# 3. Install the model's pinned requirements once, then restart the session
import os, pathlib, sys
MARK = pathlib.Path("/content/.clairic_installed")
if not MARK.exists():
    !pip install -q -r {MODEL_DIR}/requirements.txt
    MARK.write_text("ok")
    print("Installed. The session restarts now: choose Runtime -> Run all again.")
    os.kill(os.getpid(), 9)
else:
    import torch, transformers
    print("already installed: torch", torch.__version__, "| transformers", transformers.__version__)
""")

code(r"""
# 4. Load Clairic Flash
import sys
from huggingface_hub import snapshot_download
MODEL_DIR = snapshot_download("Cloudflare/clairic-flash")
sys.path.insert(0, MODEL_DIR)
import torch, pathlib
# DeepGEMM's bf16 GEMM asserts "Unsupported architecture" below Hopper (seen on A100, 19 Nov).
# Below compute 9.0, send that one call to the runtime's own Triton fallback (its non-bf16 path).
# On an H100 nothing is patched.
math_py = pathlib.Path(MODEL_DIR) / "clairic_runtime" / "math.py"
src = math_py.read_text()
GUARD = "and b.shape[1] >= 16):"
if torch.cuda.get_device_capability(0)[0] < 9 and "get_device_capability(a.device)" not in src:
    assert GUARD in src, "math.py changed upstream; patch no longer applies"
    math_py.write_text(src.replace(GUARD, "and b.shape[1] >= 16 and torch.cuda.get_device_capability(a.device)[0] >= 9):", 1))
    print("PATCHED: DeepGEMM bf16 GEMM -> Triton fallback (GPU is pre-Hopper; scores may differ slightly from H100)")
else:
    print("DeepGEMM path unchanged")
from clairic_model import load_release_model, systemone
model, processor = load_release_model(MODEL_DIR, device="cuda")
print("loaded")
""")

code(r"""
# 5. Build one request per card from the manifest: a date field and a lot field per expected row
import io, json, pathlib
from PIL import Image

CARDS = pathlib.Path("/content/hathor/cards/fixtures/synthetic_vaccination_cards")
manifest = json.loads((CARDS / "manifest.json").read_text())
LIMIT = 4 * 1024 * 1024  # Clairic: 4 MiB per embedded image

def load_image(path):
    img = Image.open(path).convert("RGB")
    buf = io.BytesIO(); img.save(buf, "PNG")
    if buf.tell() <= LIMIT:
        return img
    for q in (90, 80, 70):  # re-encode big scans (card 12 is 4.6 MB) as JPEG under the limit
        buf = io.BytesIO(); img.save(buf, "JPEG", quality=q)
        if buf.tell() <= LIMIT:
            return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    img.thumbnail((2000, 2000))
    return img

def fields_for(card):
    f = {}
    for r in card["expected_rows"]:
        where = f"the '{r['visit']}' row, {r['antigen']} dose {r['dose_number']}"
        f[f"{r['row_id']}__date"] = {"type": "date", "source_only": True,
            "instructions": f"Date written for {where}. Dates may use Western, Arabic-Indic or Persian digits, day first. Null if the date cell is empty."}
        f[f"{r['row_id']}__lot"] = {"type": "text",
            "instructions": f"Lot or batch number written for {where}, exactly as written. Null if empty."}
    return f

print(len(manifest["fixtures"]), "cards")
""")

code(r"""
# 6. Run every card (sequential: the model refuses simultaneous requests)
import time
raw = {}
for card in manifest["fixtures"]:
    t = time.time()
    try:
        # Colab runs an event loop, so the sync systemone()/predict() refuses; await the async API (same response)
        resp = await model.predict_async({
            "state": "Read the attached child vaccination card. One field per vaccine row.",
            "images": [load_image(CARDS / card["filename"])],
            "fields": fields_for(card),
        })
        raw[card["id"]] = resp
        print(f"{card['filename']:<60} {time.time()-t:5.1f}s truncated={resp.get('truncated')}")
    except Exception as e:
        raw[card["id"]] = {"error": repr(e)}
        print(f"{card['filename']:<60} ERROR {e!r}")

first = next(v for v in raw.values() if "answers" in v)
print(json.dumps(dict(list(first["answers"].items())[:2]), indent=1, default=str)[:1500])
""")

code(r"""
# 7. Score each field against the manifest
import pandas as pd

import math, re
DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

def day_first(s):
    # Hathor's rule: day first, Arabic-Indic/Persian digits, 2-digit years -> 20xx
    m = re.fullmatch(r"\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\s*", str(s).translate(DIGITS))
    if not m:
        return None
    d, mo, y = map(int, m.groups()); y = y + 2000 if y < 100 else y
    return f"{y:04d}-{mo:02d}-{d:02d}" if 1 <= mo <= 12 and 1 <= d <= 31 else None

def unpack(a, kind):
    # Clairic's own date normaliser rejects day/month-ambiguous dates ("invalid_printed_temporal",
    # confidence 0) although it read them right (run of 19 Nov). Hathor parses dates itself, so
    # score the printed text day-first, and use the sequence probability as the confidence.
    if not isinstance(a, dict):
        return a, None, None
    v = a.get("value")
    if kind == "date" and a.get("printed_value"):
        v = day_first(a["printed_value"])
    lp = a.get("log_probability")
    conf = math.exp(lp) if lp is not None else a.get("confidence")
    return v, conf, a.get("p_null")

def norm_lot(s):
    return None if s in (None, "") else str(s).strip().upper().replace(" ", "")

rows = []
for card in manifest["fixtures"]:
    ans = raw.get(card["id"], {}).get("answers", {})
    for r in card["expected_rows"]:
        for kind, want in (("date", r["date"]), ("lot", r.get("lot_number"))):
            v, conf, p_null = unpack(ans.get(f"{r['row_id']}__{kind}"), kind)
            got = (str(v)[:10] if v not in (None, "") else None) if kind == "date" else norm_lot(v)
            want = want if kind == "date" else norm_lot(want)
            rows.append({"card": card["filename"][:2], "row": r["row_id"], "field": kind,
                         "expected": want, "got": got, "correct": got == want,
                         "confidence": conf, "p_null": p_null,
                         "digits": card["digit_system"],
                         "handwritten": card["visual_conditions"].get("messy_handwriting")})
df = pd.DataFrame(rows)
print("fields:", len(df), "| correct:", df.correct.mean().round(3))
print(df.groupby("card").correct.mean().round(2).to_string())
print(df.groupby("field").correct.mean().round(2).to_string())
""")

code(r"""
# 8. The question: do low-confidence fields catch the wrong ones?
from sklearn.metrics import roc_auc_score
s = df.dropna(subset=["confidence"])
print("fields with a confidence score:", len(s), "of", len(df))
if s.correct.nunique() == 2:
    print("AUROC (confidence separates right from wrong):", round(roc_auc_score(s.correct, s.confidence), 3))
wrong = (~s.correct).sum()
print(f"\n{'threshold':>9} {'sent to human':>14} {'wrong caught':>13} {'wrong missed':>13}")
for th in (0.5, 0.7, 0.8, 0.9, 0.95):
    to_human = s.confidence < th
    caught = (to_human & ~s.correct).sum()
    print(f"{th:>9} {to_human.mean():>13.0%} {caught:>6}/{wrong:<6} {wrong - caught:>13}")
print("\nWrong answers the model was sure about (the dangerous ones):")
print(s[(~s.correct) & (s.confidence >= 0.9)][["card", "row", "field", "expected", "got", "confidence"]].to_string() or "none")
""")

code(r"""
# 9. Save results (download the zip; nothing is uploaded anywhere)
import shutil, pathlib
out = pathlib.Path("/content/clairic_results"); out.mkdir(exist_ok=True)
df.to_csv(out / "fields.csv", index=False)
(out / "raw_responses.json").write_text(json.dumps(raw, indent=1, default=str, ensure_ascii=False))
shutil.make_archive("/content/clairic_results", "zip", out)
from google.colab import files
files.download("/content/clairic_results.zip")
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"gpuType": "A100", "provenance": []},
      "kernelspec": {"display_name": "Python 3", "name": "python3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}
(HERE / "clairic_flash_synthetic_cards.ipynb").write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n")
print("wrote", HERE / "clairic_flash_synthetic_cards.ipynb", len(cells), "cells")
