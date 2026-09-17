# OT neutral-report noncanonical PR disposition manifest

Date: 2026-09-15 CDT
Status: disposition recorded only. No PR in this manifest was closed, merged, or modified by this record.

## Rule

Only the exact main-rooted chain in `docs/ops/ot-neutral-canonical-equivalence-2026-09-15.md` is canonical. Every PR below is excluded from merge/adoption. Preserve all of them until terminal CI/Vercel evidence, independent reviews, and exact-tree reconciliation pass.

## Exact excluded set

| PR | Base branch | Head branch | Exact head | Recorded reason/title |
|---:|---|---|---|---|
| #47 | `main` | `codex/ot-neutral-report-20260915` | `2203e06d995a29d928ee9efae81771efb00fcbcf` | feat: add neutral assessment records report |
| #48 | `codex/ot-neutral-foundation-12-deadline-authority` | `codex/ot-neutral-stack-1-foundation` | `fc4a0378a22adbb4c38901ed10c0de5ac2b295f2` | OT neutral stack 1/6: shared paid authority foundation |
| #49 | `codex/ot-neutral-stack-1-foundation` | `codex/ot-neutral-stack-2-evidence` | `6fb863f2a7359ed11e066cdfe07187b7580a58ae` | OT neutral stack 2/6: evidence artifact |
| #50 | `codex/ot-neutral-stack-2-evidence` | `codex/ot-neutral-stack-3-commerce` | `133d84afdb9eac6df7ebd4adb8e905c1d51be9b3` | OT neutral stack 3/6: commerce admission |
| #51 | `codex/ot-neutral-stack-3-commerce` | `codex/ot-neutral-stack-4-qa-refund` | `6abdcafc322d73b26905fa9b4f88fdb184ee3a56` | OT neutral stack 4/6: QA and refund control |
| #52 | `codex/ot-neutral-stack-5b-delivery-authority` | `codex/ot-neutral-stack-5-delivery-surfaces` | `8422fbb6bf39e36744567b0abcfda5bbbff3bb84` | OT neutral stack 5c: customer surfaces and owner journey |
| #53 | `codex/ot-neutral-stack-5-delivery-surfaces` | `codex/ot-neutral-stack-6-preview-controls` | `0092b2a14b4533ad099f75db28323707d9d0b981` | OT neutral stack 6: Preview controls and constrained-view proof |
| #54 | `main` | `codex/ot-neutral-foundation-01-artifact-core` | `896665519844c8035580f0bf97054b3c972e9fde` | OT foundation 1: deterministic artifact core |
| #55 | `codex/ot-neutral-foundation-01-artifact-core` | `codex/ot-neutral-foundation-02-orchestration` | `a15170641a29b57214bfa76a97cc5e5dfec3b074` | OT foundation 2: gated artifact orchestration |
| #56 | `codex/ot-neutral-foundation-02-orchestration` | `codex/ot-neutral-foundation-03-pdf-storage` | `6a7a44d044c7badf80064a3e9f384fc125b757df` | OT foundation 3: PDF and private storage |
| #57 | `codex/ot-neutral-foundation-03-pdf-storage` | `codex/ot-neutral-foundation-04-county-gateway` | `55eed74ba781c69a9a933b1dfa42d73ea2232274` | OT foundation 4: official county gateway |
| #58 | `codex/ot-neutral-foundation-04-county-gateway` | `codex/ot-neutral-foundation-05-attribution` | `035baf2adbe4df9e1e42c49361db0fe60efde3d1` | OT foundation 5: privacy-safe attribution |
| #59 | `codex/ot-neutral-foundation-05-attribution` | `codex/ot-neutral-foundation-06-packet-download` | `7a00fc3afe6b6ff965ac4df77ee34cfff336b007` | OT foundation 6: secure packet download |
| #60 | `codex/ot-neutral-foundation-06-packet-download` | `codex/ot-neutral-foundation-07-packet-fence` | `bc17cf0e453302133dd211e45ab6675913c08540` | OT foundation 7: packet authority fence |
| #61 | `codex/ot-neutral-foundation-07-packet-fence` | `codex/ot-neutral-foundation-08-delivery-callbacks` | `2d6cccc5e5c98c9c9b3a176aa411b305d92fb308` | OT foundation 8: delivery callbacks and issuance |
| #62 | `codex/ot-neutral-foundation-08-delivery-callbacks` | `codex/ot-neutral-foundation-09-delivery-safety` | `a4f42440ed6555654cae1240c15199f31ffe9c99` | OT foundation 9: delivery safety remediation |
| #63 | `codex/ot-neutral-foundation-09-delivery-safety` | `codex/ot-neutral-foundation-10-private-surface` | `990d705080ae964610cdb52b08fa0f6d62b40b66` | OT foundation 10: private surface isolation |
| #64 | `codex/ot-neutral-foundation-10-private-surface` | `codex/ot-neutral-foundation-11-payment-reversal` | `1891cad957477f518115dc7502eefebe49bc1524` | OT foundation 11: payment and reversal authority |
| #65 | `codex/ot-neutral-foundation-11-payment-reversal` | `codex/ot-neutral-foundation-12-deadline-authority` | `3dd51c876d54af84a81c73054a6292746958fc12` | OT foundation 12: commerce deadline authority |
| #66 | `codex/ot-neutral-stack-4-qa-refund` | `codex/ot-neutral-stack-5a-customer-artifact` | `d63a93889a1787e64969bf3373eeca8c47450972` | OT neutral stack 5a: customer artifact promotion |
| #67 | `codex/ot-neutral-stack-5a-customer-artifact` | `codex/ot-neutral-stack-5b-delivery-authority` | `155a563096d196b0f6bfc9b7afda43829ed2bde4` | OT neutral stack 5b: restricted delivery authority |
| #89 | `codex/ot-neutral-deep-020-dependent-ci` | `codex/ot-neutral-deep-021-orchestrator` | `c61ad12b2dd3a38419c9fc5b33579074b256d03c` | feat(ot): add leased artifact orchestrator |
| #90 | `codex/ot-neutral-deep-021-orchestrator` | `codex/ot-neutral-deep-022-scheduling` | `ac0385d20c35ece29e14210026ce4cf14aa79fd1` | feat(ot): add default-off artifact scheduling |
| #91 | `codex/ot-neutral-deep-022-scheduling` | `codex/ot-neutral-deep-023-settlement-wire` | `af6516a35413a7ff4577ef5136879e9671fed821` | feat(ot): connect paid settlement to gated scheduling |
| #119 | `codex/ot-neutral-deep-041-attribution-closure` | `codex/ot-neutral-deep-042-delivery-schema` | `c0a8a8faa3a423ea1b3131ca27b4e07a496c361a` | feat(ot): add delivery schema and workflow primitives |
| #135 | `codex/ot-neutral-deep-042-delivery-schema` | `codex/ot-neutral-deep-043-orphan-safe` | `4da07b0107c1abdfcab938f068f39b4e8987d82a` | feat(ot): add orphan-safe delivery orchestration |
| #138 | `codex/ot-neutral-deep-043-orphan-safe` | `codex/ot-neutral-deep-044-packet-core` | `da6995627e45a437f7174f201aa0ff2f6b71e531` | feat(ot): add packet download decisions |
| #139 | `codex/ot-neutral-deep-044-packet-core` | `codex/ot-neutral-deep-045-packet-store` | `ae510c1ffde274b637c18d5ccfec0f18d0e98f96` | feat(ot): add packet download store |
| #141 | `codex/ot-neutral-deep-045-packet-store` | `codex/ot-neutral-deep-046-delivery-store` | `5fe5183d0b49a617af48488561900765c3a083f8` | feat(ot): add delivery runtime store |
| #145 | `codex/ot-neutral-deep-046-delivery-store` | `codex/ot-neutral-deep-047-delivery-route` | `5eec80863797bc42270927db9165e260854c92d9` | feat(ot): expose guarded packet route |
| #150 | `codex/ot-neutral-deep-047-delivery-route` | `codex/ot-neutral-deep-048-delivery-tests-a` | `afff28bda254f3b2214b09d9ecdcf998faef08fc` | test(ot): cover orphan-safe artifact workflow |
| #154 | `codex/ot-neutral-deep-048-delivery-tests-a` | `codex/ot-neutral-deep-049-delivery-tests-b` | `1e0144699ef93b658dcccfa4add55a5e92b09ba8` | test(ot): prove packet decisions and wiring |
| #157 | `codex/ot-neutral-deep-049-delivery-tests-b` | `codex/ot-neutral-deep-050-delivery-tests-c` | `55d90ff181e330b6d3632b159daa266aaa8b961a` | test(ot): prove guarded packet route |
| #158 | `codex/ot-neutral-deep-050-delivery-tests-c` | `codex/ot-neutral-deep-051-delivery-tests-d` | `a897dbb1bfc9aee2bc3313b7d8319bf52e8a3939` | test(ot): prove packet download persistence |
| #160 | `codex/ot-neutral-deep-051-delivery-tests-d` | `codex/ot-neutral-deep-052-delivery-tests-e` | `b7d6e34086562775e62dfd5c24868fd5c3463c9f` | test(ot): prove delivery lifecycle |
| #200 | `codex/ot-neutral-deep-112-release-gate` | `codex/ot-neutral-deep-113-ci-boundaries` | `51649a52f923231f8d46b04d43c348958b5212eb` | OT deep stack 113: align CI boundaries |

## Disposition classes

- **Aggregate reference:** #47 remains the immutable approved-tree reference and fallback; it is not part of the merge chain.
- **Obsolete aggregate/stack experiments:** #48-#67 are superseded by the explicit review-sized canonical chain.
- **Oversized/redundant orchestration sequence:** #89 is superseded by compile-safe PRs #87-#88. PRs #90-#91 are excluded because rebase proved their patches already present in #87-#88.
- **Concurrent duplicate chain:** #119, #135, #138, #139, #141, #145, #150, #154, #157, #158, and #160 are quarantined duplicates and must not be adopted.
- **Zero-diff sequencing artifact:** #200 is explicitly excluded.

## Cleanup gate

Closing any excluded PR requires a later exact readback proving the canonical chain is terminal-green, Vercel Ready, independently approved, and tree-equivalent. This file authorizes no closure.

