Compare the architecture documentation against the actual source code and report divergences.

## Instructions

1. Read the architecture documentation at `docs/architecture.md`
2. Read all source files in the following order:
   - `src/models/types.ts`
   - `src/models/protocol.ts`
   - `src/analytics/TokenCounter.ts`
   - `src/analytics/ToolStats.ts`
   - `src/monitoring/JsonlParser.ts`
   - `src/monitoring/ProjectScanner.ts`
   - `src/monitoring/TranscriptWatcher.ts`
   - `src/monitoring/SessionTracker.ts`
   - `src/DashboardPanel.ts`
   - `src/extension.ts`
3. Compare the following aspects and report any divergences:
   - **Constants**: Check all values in the Constants table (IDLE_TIMEOUT_MS, MAX_ACTIVITIES, etc.)
   - **State machine**: Verify state transitions match the documented diagram
   - **IPC protocol**: Confirm all message types in protocol.ts match the IPC Protocol tables
   - **File responsibilities**: Check that class descriptions match actual behavior
   - **Token pricing**: Verify MODEL_PRICING values match the pricing table
   - **File naming**: Confirm sub-agent detection logic matches documented conventions
4. For each divergence found, report in this format:

   ```
   ### [Component Name]
   - **DOCS SAY**: [what the documentation claims]
   - **CODE SHOWS**: [what the actual code does]
   - **PROPOSED UPDATE**: [specific edit to make the docs accurate]
   ```

5. If no divergences are found, report "Architecture docs are in sync with source code."
6. Ask for confirmation before writing any changes to `docs/architecture.md`.
