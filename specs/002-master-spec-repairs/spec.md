# Master issue 1: current-source repairs

Source: https://github.com/somdipto/dani-dex/issues/1 and its October 7 V1/V2 comments.
Baseline: d0181757a3d1d7f7b21470d49dec8832aefd52a6, version 0.17.8.
Owner instruction: fix the issue for both versions and raise a PR; close only after all requirements are met.
This instruction authorizes implementation and the PR despite the older planning-only labels.

P0/R1: personal context never follows the selected remote server or a different account.
P0/R2: failed or ambiguous imports retain their original destination and retry without duplicate records.
P0/R3: legacy unscoped context requires a separate visible destination/content review. No automatic deletion.
P0/R4: voice preparation, cancellation, failure and teardown release their owned resources and permit recovery.
P1/R5: local voice has a real Linux runtime and the same bounded transcription contract as Mac/Windows.
R6: keep a complete V1/V2 acceptance ledger. BUILT and live/device acceptance are separate claims.
R7: failed optional LAN discovery cannot prevent local development startup or expand its network exposure.

Non-goals for this patch: release promotion, domain invention, paid inference, phone-number purchase,
new provider credentials, rewriting shipped API protocols, or claiming unpublished V2 code exists.
Dependencies: actual owner accounts, signing/deployment access, native audio devices and the unpublished V2 candidate.
