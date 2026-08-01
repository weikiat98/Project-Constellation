# Observations

Side-findings noticed while doing other tasks. Not yet triaged into fixes.

---

## 2026-08-01: No "June_UAT_Checklist.md" exists : UAT checklist coverage of safety-testing themes is thin

**Context**: TO-DO.md asked to check whether `safety testing/safetytests_reference.md` content is reflected in "June_UAT_Checklist.md". No file by that name exists in `UAT/`. The only files present are `UAT/Aug_UAT_Checklist.md` (v2.3.3, dated August 2026), `UAT/UAT_CHECKLIST.md` (v2.1, older/generic), and two `25April_*` files. Recent commit history (`Add June 2026 UAT Checklist for version 2.3.3` -> `fix: update UAT checklist date to July 2026` -> current Aug date) strongly suggests the June checklist was iteratively renamed/updated in place rather than deleted, ending up as `Aug_UAT_Checklist.md`. Comparison below was done against that file as the best current stand-in.

**Finding**: `safetytests_reference.md` proposes 13 adversarial/security test themes (T1-T13). Cross-referencing against `Aug_UAT_Checklist.md`:

| Theme | Severity | UAT coverage |
|---|---|---|
| T1 Prompt injection via document content | Critical | **Not covered** : no UAT item exercises adversarial instructions embedded in uploaded documents |
| T2 Citation hallucination/fabrication | Critical | Covered : §22 (hallucinated chunk ID warnings, citation validity, UUID pill rendering) |
| T3 System prompt extraction / jailbreaking | Critical | **Not covered** : no UAT item attempts prompt extraction or persona/role-escalation prompts |
| T4 Cross-session data leakage | High | Partial : §20 covers stream/message isolation; T4-B's cross-session `GET /chunks/{id}` access is not tested anywhere (§26.11 only checks metadata shape) |
| T5 Tool scope boundary enforcement | High | **Not covered** |
| T6 Runaway agent / resource exhaustion | High | **Not covered** : §16 exercises normal compaction only, not adversarial high-entropy documents or spawn cascades |
| T7 Artifact content safety (HTML/CSV injection) | High | **Not covered** : §10 checks HTML/CSV *rendering*, not sandbox escape or formula-injection payloads |
| T8 Input validation / malformed docs | Medium | Substantially covered : §3.10-3.11, §5, §25.2-25.3 (corrupt files, unsupported types, zero-byte, oversized). FTS5-injection-via-document-content (T8-B) only loosely touched by §22.10 |
| T9 Semantic citation accuracy | Medium | **Not covered** |
| T10 Compaction integrity | Medium | Covered : §16.11-16.14 |
| T11 Session/state integrity | Medium | Partial : §18.4 and §15.9 cover state transitions and edit/retry truncation; the specific cancel+resubmit race (T11-A) is not tested |
| T12 Audience bypass | Low | Partial : §14.9 covers accidental false-positive switching, not adversarial "ignore audience" prompts or invalid enum values via direct API |
| T13 Thinking panel disclosure | Low | **Not covered** |

**Net**: of the three CRITICAL themes, only T2 has real UAT presence; T1 and T3 have zero coverage. The UAT checklist is a functional/UX regression suite, not a security test plan, so this gap is expected but worth being explicit about before treating a "green" UAT pass as any evidence of safety-test coverage.

**Not yet decided**: whether to (a) fold a subset of T1/T3/T5-T7/T9/T13 items into the UAT checklist as a new "Security & Adversarial" section, or (b) keep `safetytests_reference.md` as a separate red-team pass run independently of UAT. Flagging for a decision, not acting on it.
