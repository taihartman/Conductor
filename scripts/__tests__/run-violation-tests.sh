#!/bin/sh
# scripts/__tests__/run-violation-tests.sh
# Automated tests for the inline violations checker.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKER="$SCRIPT_DIR/../check-inline-violations.sh"
PASS=0
FAIL=0
TOTAL=0

# --- Test helpers ---

assert_exit() {
  local name="$1"
  local fixture="$2"
  local expected_exit="$3"
  TOTAL=$((TOTAL + 1))

  output=$(echo "$fixture" | CHECK_SOURCE=file CHECK_TEST_MODE=1 sh "$CHECKER" 2>&1)
  actual_exit=$?

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected exit=$expected_exit, got exit=$actual_exit)"
    [ -n "$output" ] && echo "$output" | head -5 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

assert_output_contains() {
  local name="$1"
  local fixture="$2"
  local expected_pattern="$3"
  TOTAL=$((TOTAL + 1))

  output=$(echo "$fixture" | CHECK_SOURCE=file CHECK_TEST_MODE=1 sh "$CHECKER" 2>&1)

  if echo "$output" | grep -q "$expected_pattern"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected pattern: $expected_pattern)"
    [ -n "$output" ] && echo "$output" | head -3 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

assert_output_not_contains() {
  local name="$1"
  local fixture="$2"
  local unexpected_pattern="$3"
  TOTAL=$((TOTAL + 1))

  output=$(echo "$fixture" | CHECK_SOURCE=file CHECK_TEST_MODE=1 sh "$CHECKER" 2>&1)

  if echo "$output" | grep -q "$unexpected_pattern"; then
    echo "  FAIL: $name (unexpected pattern found: $unexpected_pattern)"
    echo "$output" | grep "$unexpected_pattern" | head -2 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  fi
}

assert_violation_count() {
  local name="$1"
  local fixture="$2"
  local expected_count="$3"
  TOTAL=$((TOTAL + 1))

  output=$(echo "$fixture" | CHECK_SOURCE=file CHECK_TEST_MODE=1 sh "$CHECKER" 2>&1)

  if echo "$output" | grep -q "Found $expected_count inline"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected $expected_count violations)"
    echo "$output" | head -1 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

# --- Tests ---

echo "=== Inline Violation Checker Tests ==="
echo ""

echo "--- Basic behavior ---"
assert_exit "Clean file passes" "$SCRIPT_DIR/fixture-clean.tsx" 0
assert_exit "Violations file fails" "$SCRIPT_DIR/fixture-violations.tsx" 1
assert_exit "Suppressed file passes" "$SCRIPT_DIR/fixture-suppressed.tsx" 0
assert_exit "Empty input passes" "" 0

echo ""
echo "--- Violation categories detected ---"
assert_output_contains "Detects INLINE_COLOR (rgba)" "$SCRIPT_DIR/fixture-violations.tsx" "INLINE_COLOR"
assert_output_contains "Detects INLINE_COLOR (hex)" "$SCRIPT_DIR/fixture-violations.tsx" "#ff0000"
assert_output_contains "Detects INLINE_STRING (title)" "$SCRIPT_DIR/fixture-violations.tsx" "INLINE_STRING"
assert_output_contains "Detects MAGIC_NUMBER (px)" "$SCRIPT_DIR/fixture-violations.tsx" "MAGIC_NUMBER"
assert_output_contains "Detects MAGIC_NUMBER (.slice)" "$SCRIPT_DIR/fixture-violations.tsx" "slice"
assert_output_contains "Detects comparison threshold" "$SCRIPT_DIR/fixture-violations.tsx" "< 50"

echo ""
echo "--- Exclusion rules ---"
assert_output_not_contains "SVG fill= excluded" "$SCRIPT_DIR/fixture-clean.tsx" "INLINE_COLOR"
assert_output_not_contains "Comment rgba excluded" "$SCRIPT_DIR/fixture-clean.tsx" "INLINE_COLOR"
assert_output_not_contains ".length excluded" "$SCRIPT_DIR/fixture-clean.tsx" "MAGIC_NUMBER"
assert_output_not_contains "Single-digit px excluded" "$SCRIPT_DIR/fixture-clean.tsx" "MAGIC_NUMBER"
assert_output_not_contains ".slice < 10 excluded" "$SCRIPT_DIR/fixture-clean.tsx" "slice"

echo ""
echo "--- Suppression syntax ---"
assert_output_not_contains "// inline-ok suppresses" "$SCRIPT_DIR/fixture-suppressed.tsx" "INLINE_COLOR"
assert_output_not_contains "/* inline-ok */ suppresses" "$SCRIPT_DIR/fixture-suppressed.tsx" "INLINE_STRING"
assert_output_not_contains "{/* inline-ok */} suppresses" "$SCRIPT_DIR/fixture-suppressed.tsx" "MAGIC_NUMBER"

echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
