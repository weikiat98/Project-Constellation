# Reflections

## 2026-08-01: Model version bump + CVE_scan deprecation checks + UAT/safety-test cross-reference

**What was done**:
- `backend/orchestrator/lead.py`: `MODEL` default and `ADVISOR_MODEL` example/comments bumped from `claude-sonnet-4-6`/`claude-opus-4-7` to `claude-sonnet-5`/`claude-opus-5`, matching the model roles table already in CLAUDE.md.
- `safety testing/CVE_scan.py`: added a Step 5 that auto-discovers every package from `requirements.txt` and `frontend/package.json`, then loops `pip index versions` (flagging yanked releases) and `npm show <pkg> deprecated` (printing the registry deprecation message) across all of them in one run.
- Cross-referenced `safety testing/safetytests_reference.md` against the UAT checklist; logged the coverage gap table to `OBSERVATIONS.md`.
- Answered a SQLite-audit-viewing question inline (DB Browser for SQLite / VS Code extension / `sqlite3` CLI, read-only against WAL mode).

**Surprise finding**: the TO-DO item referenced "June_UAT_Checklist.md", but no such file exists — only `UAT/Aug_UAT_Checklist.md` does. Git commit messages ("Add June 2026 UAT Checklist" -> "update UAT checklist date to July 2026" -> current August date) show this is the same file, renamed and re-dated in place across months rather than being a separate document. Mid-task, the user's TO-DO.md itself was live-edited to say "Aug_UAT_Checklist.md" instead of "June", confirming the assumption without needing to dig through `git log --follow` (which the user interrupted — a sign to stop the archaeology and just proceed with the best available file rather than treating the filename literally).

**What I'd do differently**: when a referenced filename doesn't exist, check the working file for a live correction before spending tool calls on git history forensics — the user was already ahead of me and had fixed the name in the source document I was about to re-read anyway.

**Net result**: three of four TO-DO items were pure code/analysis edits; the fourth ("SQLite audit viewing") was a question best answered in conversation, not as a file change — worth noting that not every checklist item implies a diff.

## 2026-08-01 (later same day): DB rename, doc sweep, EOL auto-detection, CHANGELOG entry

**What was done**: the user added five more TO-DO items after the questions above (DB rename docs, model-version docs, EOL auto-detection, CHANGELOG entry). Before touching anything, found `backend/store/sessions.py` still had `DB_PATH = "deep_reading.db"` while a `Constellation.db` file (31MB, dated May 2) already existed on disk unused by the app — asked the user whether to fix code + docs together or docs-only, rather than guessing at a change that alters which database file the running app reads and writes. They chose code+docs. Then: renamed `DB_PATH` to `Constellation.db`; swept `README.md`/`technical_docs.md`/`CLAUDE.md` for both the stale model names and the old db filename (grep first, then targeted edits — no matches found in `ARCHITECTURE.md`, confirmed rather than assumed); rewrote `CVE_scan.py`'s EOL check to detect the running Python's `sys.version_info` and Node's version via `engines.node` in `package.json` (falling back to `node --version`) instead of a hardcoded `3.11`/`24`; added an `[Unreleased]` CHANGELOG entry summarizing all of the above plus the earlier UAT-rename/safety-gap finding.

**Surprise finding**: a stray, already-renamed `Constellation.db` sitting next to code that still pointed at the old filename is the kind of half-finished rename that's easy to miss if you only grep for the *old* name — grepping for the *target* name (or just `ls *.db`) surfaced it immediately. Worth doing both directions when a rename task shows up.

**What I'd do differently**: nothing major — pausing to ask before the DB rename (rather than silently picking "docs only" or "code+docs") was the right call given it changes runtime behavior, not just text.
