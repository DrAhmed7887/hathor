# Clairic Flash test on synthetic cards

**Question:** when [Cloudflare Clairic Flash](https://huggingface.co/Cloudflare/clairic-flash) gives a card field low confidence, is that field actually wrong? If yes, its per-field confidence can decide which fields go to the HITL review queue (`web/components/HITLPanel.tsx`).

**Data:** the 14 synthetic cards in `cards/fixtures/synthetic_vaccination_cards/`, scored against `manifest.json`. They hold fictional children and invented dates. No real card goes into Colab.

**Run (about 1 h, Colab A100 on AI Pro units):**
1. Open the notebook in Colab: `https://colab.research.google.com/github/DrAhmed7887/hathor/blob/main/evaluation/clairic/clairic_flash_synthetic_cards.ipynb`
2. Runtime → Change runtime type → **H100** if offered, else **A100** (cell 4 then routes the Hopper-only DeepGEMM matmul to the model's Triton fallback and prints `PATCHED`). A T4 won't work.
3. Runtime → **Run all**. The install cell restarts the session once; then choose Run all again.
4. The last cell downloads `clairic_results.zip` (`fields.csv`, `raw_responses.json`). Disconnect the runtime afterwards to stop spending units.

**What the notebook measures:** accuracy per card and per field (date and lot number), the AUROC of confidence for right vs wrong answers, a threshold table (share of fields sent to a human vs wrong answers caught), and the list of wrong answers given with confidence ≥ 0.9, which are the dangerous ones.

**Not covered:** real cards, comparison with Opus (needs API spend), the 27B model.

`build_notebook.py` regenerates the notebook. Edit that file, not the .ipynb.
