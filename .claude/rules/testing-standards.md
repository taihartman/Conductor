# Testing Standards

- **Every new module must have tests.** No PR merges without tests for new code.
- **Test behavior, not implementation.** Assert on outputs and side effects, not internal state.
- **Use the existing `vscode.ts` mock** for anything that imports `vscode`. Extend it when needed — don't create alternative mocks.
- **Test file naming**: `src/__tests__/<ModuleName>.test.ts`
- **Fixture files**: `src/__tests__/fixtures/` — add new JSONL fixtures for new record types or edge cases.
- **Minimum coverage for new code**: Every public method must have at least one happy-path and one error-path test.
- **When refactoring**: Write tests for the existing behavior FIRST, then refactor. Tests are the safety net.
