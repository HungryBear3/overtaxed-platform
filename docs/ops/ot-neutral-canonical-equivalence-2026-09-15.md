# OT neutral-report canonical equivalence

Date: 2026-09-15 CDT
Status: candidate only; no merge, database migration, Production change, or feature activation.

## Canonical target

- Root: current `main` at `e80ebf9edc5b6f8a848710652badfe83ec4297ab`.
- Canonical implementation tip: PR #210 at `32a70273bec8675feb6d2aa01e036f62147a9f09`.
- This evidence-only documentation update will be the next stacked PR; its exact
  head is bound by GitHub after commit rather than self-referenced in its own bytes.
- Approved aggregate reference: PR #47 at `2203e06d995a29d928ee9efae81771efb00fcbcf`.
- PR #89 was removed from canonical ancestry. Its compile-safe, already-green replacement is PRs #87-#88; redundant PRs #90-#91 are also excluded because their bytes are contained in #87-#88.
- Zero-diff sequencing PR #200 is explicitly excluded.
- Relative to the approved aggregate reference, the canonical target adds only reviewed release-proof remediation: dependent pull-request CI, canonical/disposition manifests, and the post-migration constrained-view preflight correction.

## Exact canonical chain

This is the complete, transitive, main-rooted chain. Each row binds a PR to its exact base branch, head branch, and full head SHA.

| PR | Base branch | Head branch | Exact head |
|---:|---|---|---|
| #68 | `main` | `codex/ot-neutral-deep-001-stage` | `5784d5b185d3c22c2660194ba03cb7592cf081d1` |
| #69 | `codex/ot-neutral-deep-001-stage` | `codex/ot-neutral-deep-002-stage` | `3c29953c7c884477620bff962a28fadcce46d33f` |
| #70 | `codex/ot-neutral-deep-002-stage` | `codex/ot-neutral-deep-003-stage` | `42ae16ec1bd815cb04e0fcb01b2ac809f2cb8d12` |
| #71 | `codex/ot-neutral-deep-003-stage` | `codex/ot-neutral-deep-004-artifact-foundation` | `19e207a1246faf0df69b6cf2a8cad4aa995eb1fd` |
| #72 | `codex/ot-neutral-deep-004-artifact-foundation` | `codex/ot-neutral-deep-005-stage-readiness-1` | `4c8d825a76fa9b66e8cd0eca37aa22f48d8754e7` |
| #73 | `codex/ot-neutral-deep-005-stage-readiness-1` | `codex/ot-neutral-deep-006-artifact-remediation` | `66ba9d7308b5bd7982568e399f52f00924eb9253` |
| #74 | `codex/ot-neutral-deep-006-artifact-remediation` | `codex/ot-neutral-deep-007-readiness-evidence` | `25b5b2600bfbf2c21402ad70c7e4e4d04a730eeb` |
| #75 | `codex/ot-neutral-deep-007-readiness-evidence` | `codex/ot-neutral-deep-009-business-days` | `d0a27909fac80ef51ac0fae8d2e605a8d758855f` |
| #76 | `codex/ot-neutral-deep-009-business-days` | `codex/ot-neutral-deep-010-stage-producer-runtime` | `689d3a9d7b6464399d13604275a48ddf6ec63973` |
| #77 | `codex/ot-neutral-deep-010-stage-producer-runtime` | `codex/ot-neutral-deep-011-stage-artifact-content` | `9145ea0055db55a060db53c7252fc9c606437a1a` |
| #78 | `codex/ot-neutral-deep-011-stage-artifact-content` | `codex/ot-neutral-deep-012-stage-comparables` | `121ca0eea936ca1eef0916cd107ec0f02e3c8a19` |
| #79 | `codex/ot-neutral-deep-012-stage-comparables` | `codex/ot-neutral-deep-013-stage-readiness-report` | `7fabd2eebdca2a18cf18c3b06f85ccbdd5a667b4` |
| #80 | `codex/ot-neutral-deep-013-stage-readiness-report` | `codex/ot-neutral-deep-014-stage-producer-test-a` | `a516f7a3047ed20523083e722c07eefcfa4cec2e` |
| #81 | `codex/ot-neutral-deep-014-stage-producer-test-a` | `codex/ot-neutral-deep-015-stage-producer-test-b` | `2dfe24cd712d842741c802adb86b611634062f0d` |
| #82 | `codex/ot-neutral-deep-015-stage-producer-test-b` | `codex/ot-neutral-deep-016-activate-review-remediation` | `29d269dcb51869386ccf153c1edc28ccb4be460c` |
| #83 | `codex/ot-neutral-deep-016-activate-review-remediation` | `codex/ot-neutral-deep-017-accounting-core` | `ed54ca9840e13fee38002d3592d82ae50d1daa0d` |
| #84 | `codex/ot-neutral-deep-017-accounting-core` | `codex/ot-neutral-deep-018-accounting-tests` | `f94e31ad2e8ee1f2103cc51c206de2d01d671b5d` |
| #85 | `codex/ot-neutral-deep-018-accounting-tests` | `codex/ot-neutral-deep-019-accounting-evidence` | `81dee888f66879256a4aabda16c0abad70249634` |
| #86 | `codex/ot-neutral-deep-019-accounting-evidence` | `codex/ot-neutral-deep-020-dependent-ci` | `3c9c19f01370434cb85536e8e3fc4639eac47b9b` |
| #87 | `codex/ot-neutral-deep-020-dependent-ci` | `codex/ot-neutral-deep-021-orchestration-core` | `2c1df79247dd90a66dce3396f3d019091561d085` |
| #88 | `codex/ot-neutral-deep-021-orchestration-core` | `codex/ot-neutral-deep-022-orchestration-tests` | `ea7a6a962604d1b1ef14a71752431658f77a21e8` |
| #92 | `codex/ot-neutral-deep-022-orchestration-tests` | `codex/ot-neutral-deep-024-pdf-render` | `7a9ee361c93f027c54ce215b4d8b0fd6f646990a` |
| #93 | `codex/ot-neutral-deep-024-pdf-render` | `codex/ot-neutral-deep-025-pdf-bytes` | `e4970e39c71f516926d56ec4023089b61e292c13` |
| #94 | `codex/ot-neutral-deep-025-pdf-bytes` | `codex/ot-neutral-deep-026-pdf-escapes` | `956201a327003016cfc9019025977c594484597f` |
| #95 | `codex/ot-neutral-deep-026-pdf-escapes` | `codex/ot-neutral-deep-027-private-reader` | `7b5d9c5f4fa391b2e25184dc571fca7671373374` |
| #96 | `codex/ot-neutral-deep-027-private-reader` | `codex/ot-neutral-deep-028-private-upload` | `c6cf1ccdbe3177a399dc3c745d3b8aa2b151faa3` |
| #97 | `codex/ot-neutral-deep-028-private-upload` | `codex/ot-neutral-deep-029-storage-test` | `28bc1916fc76c97016be1606c65faa3ddf447879` |
| #98 | `codex/ot-neutral-deep-029-storage-test` | `codex/ot-neutral-deep-030-county-stage` | `eddcea1e84ec43239768c25f8613c16e1eb47d6a` |
| #99 | `codex/ot-neutral-deep-030-county-stage` | `codex/ot-neutral-deep-031-county-stage` | `0617c1a526fd4adb3df446a2a496fb66233d1003` |
| #100 | `codex/ot-neutral-deep-031-county-stage` | `codex/ot-neutral-deep-032-county-stage` | `615e8bc7de93226faad0a52d3fba20c9b7e3a43e` |
| #101 | `codex/ot-neutral-deep-032-county-stage` | `codex/ot-neutral-deep-033-county-stage` | `3695999ca3fa14e5c5c4adac05e95b5283abd6e8` |
| #102 | `codex/ot-neutral-deep-033-county-stage` | `codex/ot-neutral-deep-034-county-stage` | `27f13c9b9577406168532d303b77dc69e15b6810` |
| #103 | `codex/ot-neutral-deep-034-county-stage` | `codex/ot-neutral-deep-035-county-activate` | `3423b30bd687b9449dd82d285e7a41dc72e96638` |
| #104 | `codex/ot-neutral-deep-035-county-activate` | `codex/ot-neutral-deep-036-county-bounds` | `5f584d7f26b620254314158b34f1f0ecdf2956d8` |
| #105 | `codex/ot-neutral-deep-036-county-bounds` | `codex/ot-neutral-deep-037-attribution-1` | `49c4b4998efa15def2884363c77fadfb9790c756` |
| #106 | `codex/ot-neutral-deep-037-attribution-1` | `codex/ot-neutral-deep-038-attribution-2` | `e5c96216bb46f061322a016d66756a66f6320433` |
| #107 | `codex/ot-neutral-deep-038-attribution-2` | `codex/ot-neutral-deep-039-attribution-3` | `90c5595a40f30745a19b1277ce911a95c4b7c1b5` |
| #108 | `codex/ot-neutral-deep-039-attribution-3` | `codex/ot-neutral-deep-040-attribution-4` | `86b545fc9a4941e8f3f4eb550e81ccad120563dd` |
| #178 | `codex/ot-neutral-deep-040-attribution-4` | `codex/ot-neutral-deep-040a-attribution-tests-quarantine` | `04bd7bce210867e8e79754cb62c5eba4f20d4ef3` |
| #179 | `codex/ot-neutral-deep-040a-attribution-tests-quarantine` | `codex/ot-neutral-deep-040b-attribution-tests-stage` | `e856a047c0927da1b69df117a951c694d5847947` |
| #109 | `codex/ot-neutral-deep-040b-attribution-tests-stage` | `codex/ot-neutral-deep-041-attribution-fix-1` | `e20ecc13197f0aea74f96f7ff5997f2b2929411b` |
| #110 | `codex/ot-neutral-deep-041-attribution-fix-1` | `codex/ot-neutral-deep-042-attribution-fix-2` | `41e723ef2bcc604a58b7b65f74e89aa4f78e1967` |
| #111 | `codex/ot-neutral-deep-042-attribution-fix-2` | `codex/ot-neutral-deep-043-attribution-fix-3` | `6efba0fff32a8822caa6915126c572a63173d1ae` |
| #112 | `codex/ot-neutral-deep-043-attribution-fix-3` | `codex/ot-neutral-deep-044-attribution-fix-4` | `c61bbee4ba0cc3bbc0b22ebce3433c5e40054fba` |
| #120 | `codex/ot-neutral-deep-044-attribution-fix-4` | `codex/ot-neutral-deep-045-delivery-stage-a` | `d19595e40508144d02691efe74969545e43ce576` |
| #121 | `codex/ot-neutral-deep-045-delivery-stage-a` | `codex/ot-neutral-deep-46-delivery-stage` | `7243bdb1a38f0fb62e6654dbeeb384453c7cd455` |
| #122 | `codex/ot-neutral-deep-46-delivery-stage` | `codex/ot-neutral-deep-47-delivery-stage` | `e09ffcf4aba8ef5b03d7919785f3f7e4c4bb7751` |
| #123 | `codex/ot-neutral-deep-47-delivery-stage` | `codex/ot-neutral-deep-48-delivery-stage` | `55dd21735dc0ace19c71f8bb7e2a14339823eb68` |
| #124 | `codex/ot-neutral-deep-48-delivery-stage` | `codex/ot-neutral-deep-49-delivery-stage` | `e5c45ad14530b8d68e52c2123018ff2d34761569` |
| #125 | `codex/ot-neutral-deep-49-delivery-stage` | `codex/ot-neutral-deep-50-delivery-stage` | `7a7d263d516eb7abd686437dc50c93e7ea53ab33` |
| #126 | `codex/ot-neutral-deep-50-delivery-stage` | `codex/ot-neutral-deep-51-delivery-stage` | `0188798e0c59ae8b3bbc36aec7b39a790dc6c2a9` |
| #127 | `codex/ot-neutral-deep-51-delivery-stage` | `codex/ot-neutral-deep-52-delivery-stage` | `c2aeb3d8e3549b25680f1f86318e995dd0261714` |
| #128 | `codex/ot-neutral-deep-52-delivery-stage` | `codex/ot-neutral-deep-53-delivery-stage` | `dd771133f1a2c6904fdaad880ea26a3cdc9d55aa` |
| #129 | `codex/ot-neutral-deep-53-delivery-stage` | `codex/ot-neutral-deep-54-delivery-stage` | `bac885fae39168123a49f332970868622df868d8` |
| #130 | `codex/ot-neutral-deep-54-delivery-stage` | `codex/ot-neutral-deep-55-delivery-stage` | `0d4c6f3d70b942d22f3b89a0ed41267ae4682a00` |
| #131 | `codex/ot-neutral-deep-55-delivery-stage` | `codex/ot-neutral-deep-56-delivery-stage` | `f0ad951f5e75e83da2c56a8e89b63016d037af7e` |
| #132 | `codex/ot-neutral-deep-56-delivery-stage` | `codex/ot-neutral-deep-57-delivery-stage` | `e14891873660fae70ec16638320dfc8f800d7218` |
| #133 | `codex/ot-neutral-deep-57-delivery-stage` | `codex/ot-neutral-deep-58-delivery-stage` | `0f5731650f48f506d6c6badb803a4a5d44cdc1e8` |
| #134 | `codex/ot-neutral-deep-58-delivery-stage` | `codex/ot-neutral-deep-59-delivery-stage` | `925fbc51e87b4b1137b98e1b462632f4a478ae62` |
| #136 | `codex/ot-neutral-deep-59-delivery-stage` | `codex/ot-neutral-deep-060-delivery-activate` | `4cd58bca1ef9631fae03d08dd2e6bf75b663fd48` |
| #137 | `codex/ot-neutral-deep-060-delivery-activate` | `codex/ot-neutral-deep-061-delivery-authority` | `0ae3a4c5823df1bddde724b85fd3066b74b769a8` |
| #140 | `codex/ot-neutral-deep-061-delivery-authority` | `codex/ot-neutral-deep-62-delivery-learn-stage` | `dbc9dd6dc703a2ec1e7c6817fce6c3171d04edbc` |
| #142 | `codex/ot-neutral-deep-62-delivery-learn-stage` | `codex/ot-neutral-deep-63-delivery-learn-stage` | `27f86611fe4528a410ba8536680d58005f463b13` |
| #143 | `codex/ot-neutral-deep-63-delivery-learn-stage` | `codex/ot-neutral-deep-64-delivery-learn-stage` | `3e9fec250194cf8f213bebd0cc8ae80570effe4a` |
| #144 | `codex/ot-neutral-deep-64-delivery-learn-stage` | `codex/ot-neutral-deep-65-delivery-learn-stage` | `1dc8a46b1b824973219ac7e7fefce049d09a855f` |
| #146 | `codex/ot-neutral-deep-65-delivery-learn-stage` | `codex/ot-neutral-deep-66-delivery-learn-stage` | `583b1f634f8e9d8bf9d94cded59edd1089c22640` |
| #147 | `codex/ot-neutral-deep-66-delivery-learn-stage` | `codex/ot-neutral-deep-67-delivery-learn-stage` | `6e33cae8da4e3340475e1c90d623c541475430ec` |
| #148 | `codex/ot-neutral-deep-67-delivery-learn-stage` | `codex/ot-neutral-deep-68-delivery-learn-stage` | `d49f25a57948d425580f35afb76b1b5efef6c6d9` |
| #149 | `codex/ot-neutral-deep-68-delivery-learn-stage` | `codex/ot-neutral-deep-69-delivery-learn-stage` | `aceda1de02e3398b6d5ef311f9712c9bc18ff425` |
| #151 | `codex/ot-neutral-deep-69-delivery-learn-stage` | `codex/ot-neutral-deep-70-delivery-learn-stage` | `143e2df93c9f1d90f78e5a415f7dcf51c0d17073` |
| #152 | `codex/ot-neutral-deep-70-delivery-learn-stage` | `codex/ot-neutral-deep-71-delivery-learn-stage` | `d5a7d4001a55fd9be99b74d9b8f39ed129de3c8d` |
| #153 | `codex/ot-neutral-deep-71-delivery-learn-stage` | `codex/ot-neutral-deep-72-delivery-learn-stage` | `526e2dafc207a19081e33c6ff94450aff44fd407` |
| #155 | `codex/ot-neutral-deep-72-delivery-learn-stage` | `codex/ot-neutral-deep-73-delivery-learn-stage` | `a506fa7fa1f0a926d51b26bc2cdbd1102bee57a2` |
| #156 | `codex/ot-neutral-deep-73-delivery-learn-stage` | `codex/ot-neutral-deep-74-delivery-learn-stage` | `fe9c0f23791468a498270847829770011618e729` |
| #159 | `codex/ot-neutral-deep-74-delivery-learn-stage` | `codex/ot-neutral-deep-075-delivery-learn-activate` | `e9a54a19073ef090ee19c554225ae5271287e6dd` |
| #161 | `codex/ot-neutral-deep-075-delivery-learn-activate` | `codex/ot-neutral-deep-76-delivery-safety-stage` | `0668fe61e861977cddfe63773f9cd9777c4ed171` |
| #162 | `codex/ot-neutral-deep-76-delivery-safety-stage` | `codex/ot-neutral-deep-77-delivery-safety-stage` | `f2ede01a81a7072fd29d6a1ff977cbd512c6e7b9` |
| #163 | `codex/ot-neutral-deep-77-delivery-safety-stage` | `codex/ot-neutral-deep-78-delivery-safety-stage` | `9eec16aefd67e34e4b812270f2faf10387febb4f` |
| #164 | `codex/ot-neutral-deep-78-delivery-safety-stage` | `codex/ot-neutral-deep-79-delivery-safety-stage` | `5f4d4aed582e67b7263ce78edf2a0aca357862fc` |
| #165 | `codex/ot-neutral-deep-79-delivery-safety-stage` | `codex/ot-neutral-deep-80-delivery-safety-stage` | `6d7492ad105bf58a0a6fd5c9c8ab20e5e85062ba` |
| #166 | `codex/ot-neutral-deep-80-delivery-safety-stage` | `codex/ot-neutral-deep-081-delivery-safety-activate` | `120bcb3838e8bd0697a3056f6ee5cd74ffcf4bde` |
| #167 | `codex/ot-neutral-deep-081-delivery-safety-activate` | `codex/ot-neutral-deep-82-delivery-gap-stage` | `511f5337daee3667c8b916fea2e4ebe92d73e671` |
| #168 | `codex/ot-neutral-deep-82-delivery-gap-stage` | `codex/ot-neutral-deep-83-delivery-gap-stage` | `5c39ff324a2079c2fc94425b7c212e7ba0dabd86` |
| #169 | `codex/ot-neutral-deep-83-delivery-gap-stage` | `codex/ot-neutral-deep-84-delivery-gap-stage` | `5fc614dbcefa90bbb5fef142f399b0029fe92160` |
| #170 | `codex/ot-neutral-deep-84-delivery-gap-stage` | `codex/ot-neutral-deep-85-delivery-gap-stage` | `50a6d77953f7758718644a647b55d9dc3bbe13c7` |
| #171 | `codex/ot-neutral-deep-85-delivery-gap-stage` | `codex/ot-neutral-deep-086-delivery-gap-activate` | `1fc248de72297e1593a81b6eaf4d542bfe5ca8a1` |
| #172 | `codex/ot-neutral-deep-086-delivery-gap-activate` | `codex/ot-neutral-deep-87-fixot-isolate-packet-from-all-instr` | `f042423c88b1c9228cff6adda955bc09c12f6f18` |
| #173 | `codex/ot-neutral-deep-87-fixot-isolate-packet-from-all-instr` | `codex/ot-neutral-deep-88-docsot-record-the-reconciliation-th` | `3d4ddd6371c26a02a1884c61807c76e76c639ff1` |
| #174 | `codex/ot-neutral-deep-88-docsot-record-the-reconciliation-th` | `codex/ot-neutral-deep-89-fixot-isolate-packet-form-across-cl` | `a5b68a59651cf98b8fef1cee3224442adb9cf01a` |
| #175 | `codex/ot-neutral-deep-89-fixot-isolate-packet-form-across-cl` | `codex/ot-neutral-deep-90-fixot-cast-advisory-lock-result-for` | `5c225c1a867546ffabd8c5efc192f7a93d7203e2` |
| #176 | `codex/ot-neutral-deep-90-fixot-cast-advisory-lock-result-for` | `codex/ot-neutral-deep-91-fixot-durably-hold-settlement-on-st` | `b24555d75bf5ee5ed9df8558361a9256b826c8f8` |
| #177 | `codex/ot-neutral-deep-91-fixot-durably-hold-settlement-on-st` | `codex/ot-neutral-deep-92-fixot-require-trusted-payment-bindi` | `ff3c1e7ed59737a38410389faebe39a4bba2e1f8` |
| #180 | `codex/ot-neutral-deep-92-fixot-require-trusted-payment-bindi` | `codex/ot-neutral-deep-093-recovery-outcome` | `33594a2c5e9c2e4f933af6765b01365093ce641c` |
| #181 | `codex/ot-neutral-deep-093-recovery-outcome` | `codex/ot-neutral-deep-094-refusal-diagnostics` | `4b507ba86e8101329a614862f2810dbd8530a065` |
| #182 | `codex/ot-neutral-deep-094-refusal-diagnostics` | `codex/ot-neutral-deep-095-unsigned-target` | `571a320ef8d538d527a5b976213ce7171b9b2a15` |
| #183 | `codex/ot-neutral-deep-095-unsigned-target` | `codex/ot-neutral-deep-096-deadline-authority` | `d6a5a761c3ea415573d2863352ddd9afa9ae0cdd` |
| #184 | `codex/ot-neutral-deep-096-deadline-authority` | `codex/ot-neutral-deep-097-deadline-hardening` | `f9b9301aed35f6fd6ad29b8ca1a3de4b2198ccad` |
| #185 | `codex/ot-neutral-deep-097-deadline-hardening` | `codex/ot-neutral-deep-098-capture-authority` | `bc60d69737acc72d4c55a16f67b9cc588c80bb3c` |
| #186 | `codex/ot-neutral-deep-098-capture-authority` | `codex/ot-neutral-deep-099-owner-privileges` | `c12ad3314d43e702582fc67e5351de4610ee6816` |
| #187 | `codex/ot-neutral-deep-099-owner-privileges` | `codex/ot-neutral-deep-100-owner-decisions` | `a53dc07abc521b6c5764dbd2838eccd4315dcc03` |
| #188 | `codex/ot-neutral-deep-100-owner-decisions` | `codex/ot-neutral-deep-101-evidence-pipeline-runtime` | `ca335f94d651a753a049dead9f9964da54074b12` |
| #189 | `codex/ot-neutral-deep-101-evidence-pipeline-runtime` | `codex/ot-neutral-deep-102-evidence-pipeline-tests` | `ba54455629c1048672933852480e1f308c1fefe8` |
| #190 | `codex/ot-neutral-deep-102-evidence-pipeline-tests` | `codex/ot-neutral-deep-103-checkout-schema` | `cef5d643f5676e1bc196ce519c031b485a9d3266` |
| #191 | `codex/ot-neutral-deep-103-checkout-schema` | `codex/ot-neutral-deep-104-checkout-runtime` | `fa75c99ad6596ce4e29d85aacd05b7de2ffbf33a` |
| #192 | `codex/ot-neutral-deep-104-checkout-runtime` | `codex/ot-neutral-deep-105-checkout-tests` | `beb4b1af7c1f2f66cac9da1e93b11b4ce37ff670` |
| #193 | `codex/ot-neutral-deep-105-checkout-tests` | `codex/ot-neutral-deep-106-qa-delivery-schema` | `5ba6f3c24475a38382abd665f48d6c4c9ef96a26` |
| #194 | `codex/ot-neutral-deep-106-qa-delivery-schema` | `codex/ot-neutral-deep-107-qa-delivery-runtime` | `8e07a858899cfa4c7f483e8b9775fe39c454c26a` |
| #195 | `codex/ot-neutral-deep-107-qa-delivery-runtime` | `codex/ot-neutral-deep-108-delivery-integration` | `f4f7e213e9229d08950bf5ea19d3463ea4af81dd` |
| #196 | `codex/ot-neutral-deep-108-delivery-integration` | `codex/ot-neutral-deep-109-neutral-copy` | `d3079f2bb098c23fd1b6682c05f5e618949ef74f` |
| #197 | `codex/ot-neutral-deep-109-neutral-copy` | `codex/ot-neutral-deep-110-qa-delivery-tests` | `b74f488ed07474c70da4e90304e612552f160f76` |
| #198 | `codex/ot-neutral-deep-110-qa-delivery-tests` | `codex/ot-neutral-deep-111-owner-journey` | `ad85bd3456a99016e662e468d8a066ba95629a59` |
| #199 | `codex/ot-neutral-deep-111-owner-journey` | `codex/ot-neutral-deep-112-release-gate` | `1a8587917e57c7e3270522c23f1f510eb9a37aa3` |
| #201 | `codex/ot-neutral-deep-112-release-gate` | `codex/ot-neutral-deep-114-preview-preflight` | `91e42b3c37c1f42fdbb927ca99fab3eead564e3b` |
| #202 | `codex/ot-neutral-deep-114-preview-preflight` | `codex/ot-neutral-deep-115-release-evidence` | `3df19e744a5de9373a5ca79bc2e794a5072d1527` |
| #203 | `codex/ot-neutral-deep-115-release-evidence` | `codex/ot-neutral-deep-116-preview-identity` | `2f7bbce05d17cfaaceae2ff0926f6202f6ac22e1` |
| #204 | `codex/ot-neutral-deep-116-preview-identity` | `codex/ot-neutral-deep-117-preview-migration-gate` | `c5b659d6c381f0265c93b3dec2410b736381ca24` |
| #205 | `codex/ot-neutral-deep-117-preview-migration-gate` | `codex/ot-neutral-deep-118-preview-migration-docs` | `2b0a7397aca101eb062cbfda0d468c211ead0dfe` |
| #206 | `codex/ot-neutral-deep-118-preview-migration-docs` | `codex/ot-neutral-deep-119-preview-activators` | `fdb02c5bdfde469e1d3146abe6e4ba33cc4854f9` |
| #207 | `codex/ot-neutral-deep-119-preview-activators` | `codex/ot-neutral-deep-120-preview-evidence` | `8f648a16e89f78a415ae3e6558c7cdb51612a0c3` |
| #208 | `codex/ot-neutral-deep-120-preview-evidence` | `codex/ot-neutral-deep-121-commerce-read-hardening` | `d4fe5b88d0726f6ad5ae7fad346cd39ee82cce3a` |
| #209 | `codex/ot-neutral-deep-121-commerce-read-hardening` | `codex/ot-neutral-deep-122-release-packet` | `c32f95ff1fc2c8546e0dea8efc210393dce45c5f` |
| #210 | `codex/ot-neutral-deep-122-release-packet` | `codex/ot-neutral-deep-123-post-migration-preflight` | `32a70273bec8675feb6d2aa01e036f62147a9f09` |

## Equivalence and review structure

Before the final evidence-only manifests and post-migration preflight correction, the implementation tree was byte-identical to approved `2203e06` except for the intentional `.github/workflows/ci.yml` remediation that attaches CI to dependent PRs. The constrained-view preflight correction changes only:

- `scripts/preflight-neutral-report-migration.ts`
- `__tests__/fulfillment/neutral-qa-delivery-migration.test.ts`

The correction preserves the hardened migration: the neutral runtime receives SELECT only on `ot_neutral_runtime_order`, `ot_neutral_runtime_payment_binding`, and `ot_neutral_runtime_settlement_reversal`; direct shared-table reads remain revoked and are actively proved denied.

Every canonical PR is within 30 files and 800 changed lines, except isolated mechanical/schema artifacts documented in their PR body. PR #89's prior substantive overage is resolved by adopting PRs #87-#88.

## Verification evidence

- Focused preflight/migration suites: 29/29 passed.
- TypeScript: passed.
- Full exact-head CI and Vercel status remain terminal gates after the ancestry rewrite.
- Neutral features remain default-off.
- Preview database proof remains blocked until a provably isolated Preview database marker and four distinct restricted credentials exist.

## Hard gates

Do not merge, close PR #47 or any excluded PR, migrate a database, change Production, activate a feature, handle a real payment/refund/customer, or perform marketing based on this manifest. Those actions remain separately gated.
