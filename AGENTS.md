# mobile-tg-maker — rules for coding agents

Turns any state's Teacher Guide PDFs into a mobile web app (one shared app, one config per state).

- Start with `README.md` and `docs/NEW_STATE.md`. State-specific knowledge goes in
  `states/<state>/` (state.json, guides/*.profile.json, anomalies.json) — **never in engine/ or app/ code**.
- `_inspiration/` is an archived clone of the UP project this was built from: read-only, its rules
  do not apply here (see `INSPIRATION.md`).
- Fidelity: transcriptions copy the page exactly; never paraphrase, translate or "fix" source text.
  A misprint stays as printed unless it affects placement; then record it with evidence in
  `anomalies.json` (the app shows the notice to teachers).
- Placement errors are the worst failure. `engine/verify.py` errors block publishing; do not
  silence a check — fix the transcription or record a confirmed source anomaly.
- Source PDFs are not committed. Transcriptions (`states/*/work/vision/**`) are committed: they are
  expensive to regenerate.
- Teacher data stays on the device (localStorage). Do not add tracking that sends personal data
  without the owner's decision.
- After changing engine or app code, run `python engine/pipeline.py haryana` and check the app in a
  browser at 360px width.
