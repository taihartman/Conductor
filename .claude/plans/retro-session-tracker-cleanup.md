# Plan: SessionTracker getState() Extraction + Test Helper Consolidation

Addresses retro findings #1 and #3 from the continuation-merge implementation.

---

## Finding #1: Extract session assembly from `getState()`

**Problem:** `getState()` has ~80 lines of inline logic: deduplication tracking, group resolution, conditional merging, child-agent attachment, and sorting. Adding any new presentation concern requires weaving more logic into this method.

**Impact:** Growing bug surface area in the most-called method (every 100ms during active sessions).

### Steps

1. Extract a private `assembleSessionList(focusedSessionId)` method from `getState()` lines ~380–443
2. Move the continuation grouper freshness check, child mapping, merge calls, orphan handling, and sorting into it
3. `getState()` becomes a thin composer: `{ sessions: this.assembleSessionList(id), activities: ..., conversation: ..., toolStats: ..., tokenSummaries: ... }`
4. Verify all tests pass unchanged

**Files:** `src/monitoring/SessionTracker.ts`
**Scope:** small (single method extraction, same file)

---

## Finding #3: Consolidate duplicated `feedRecords` test helpers

**Problem:** `SessionTracker.test.ts` has 6 identical copies of `feedRecords` across different `describe` blocks. Each block also has its own record builder helpers (`makeToolUseRecord`, etc.) that can have inconsistent defaults (the `slug: "test"` collision we hit).

**Impact:** Future tests creating 2+ sessions risk unintended continuation merging. Each fix is a one-off patch in a single block.

### Steps

1. Hoist `feedRecords` to a top-level helper outside all `describe` blocks (or a shared test utility file)
2. Accept an optional `slug` parameter defaulting to `sessionId`
3. Remove the 6 inline copies
4. Audit each block's record builder helpers to ensure they use `sessionId` as slug by default
5. Run full test suite to verify

**Files:** `src/__tests__/SessionTracker.test.ts`
**Scope:** medium (touches many test blocks, careful to preserve per-block setup)
