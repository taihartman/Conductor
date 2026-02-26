#!/bin/sh
# scripts/check-inline-violations.sh
# Checks staged .ts/.tsx files for inline coding standard violations.
#
# Usage (pre-commit):
#   git diff --cached --name-only --diff-filter=ACM -- '*.ts' '*.tsx' \
#     | sh scripts/check-inline-violations.sh
#
# Usage (manual):
#   find webview-ui/src -name '*.tsx' \
#     | CHECK_SOURCE=file sh scripts/check-inline-violations.sh
#
# Environment:
#   CHECK_SOURCE=file    Read from working tree instead of git staged content
#   CHECK_TEST_MODE=1    Skip path exclusions and webview-ui restriction (for testing)

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# --- Collect file paths from stdin ---
FILES=""
while IFS= read -r f; do
  [ -n "$f" ] && FILES="${FILES}${f}
"
done

[ -z "$FILES" ] && exit 0

# --- Helpers ---

get_content() {
  if [ "${CHECK_SOURCE:-git}" = "file" ]; then
    cat "$1" 2>/dev/null
  else
    git show ":$1" 2>/dev/null
  fi
}

is_excluded() {
  [ "${CHECK_TEST_MODE:-}" = "1" ] && return 1
  case "$1" in
    */config/*|*/__tests__/*|*/__mocks__/*|*/fixtures/*) return 0 ;;
    *.css) return 0 ;;
    */constants.ts|*/formatters.ts|*/statusConfig.ts) return 0 ;;
    *) return 1 ;;
  esac
}

is_suppressed() {
  case "$1" in
    *"// inline-ok"*|*"/* inline-ok */"*) return 0 ;;
    *) return 1 ;;
  esac
}

is_comment() {
  local trimmed
  trimmed=$(echo "$1" | sed 's/^[[:space:]]*//')
  case "$trimmed" in
    //*|\**) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Check 1: Inline Colors (.tsx only) ---
check_colors() {
  local file="$1"
  case "$file" in *.tsx) ;; *) return ;; esac

  local content
  content=$(get_content "$file") || return

  # Hex color literals in quotes: '#fff', "#ab12cd"
  echo "$content" | grep -nE "['\"]#[0-9a-fA-F]{3,8}['\"]" | while IFS=: read -r num rest; do
    is_suppressed "$rest" && continue
    is_comment "$rest" && continue
    case "$rest" in
      *fill=*|*stroke=*) continue ;;
      *import\ *|*import\	*) continue ;;
      *className*) continue ;;
    esac
    trimmed=$(echo "$rest" | sed 's/^[[:space:]]*//')
    echo "  [INLINE_COLOR] $file:$num — $trimmed" >> "$TMPFILE"
  done

  # rgba()/rgb() function calls
  echo "$content" | grep -nE "rgba?\(" | while IFS=: read -r num rest; do
    is_suppressed "$rest" && continue
    is_comment "$rest" && continue
    trimmed=$(echo "$rest" | sed 's/^[[:space:]]*//')
    echo "  [INLINE_COLOR] $file:$num — $trimmed" >> "$TMPFILE"
  done
}

# --- Check 2: Inline UI Strings (.tsx only) ---
check_strings() {
  local file="$1"
  case "$file" in *.tsx) ;; *) return ;; esac

  local content
  content=$(get_content "$file") || return

  # title/placeholder/aria-label="Multi word text" (2+ words in quotes)
  echo "$content" | grep -nE '(title|placeholder|aria-label)="[^"]*[[:space:]][^"]*"' | while IFS=: read -r num rest; do
    is_suppressed "$rest" && continue
    is_comment "$rest" && continue
    trimmed=$(echo "$rest" | sed 's/^[[:space:]]*//')
    echo "  [INLINE_STRING] $file:$num — $trimmed" >> "$TMPFILE"
  done

  # label: 'Text' in object literals
  echo "$content" | grep -nE "label:[[:space:]]*'[^']+'" | while IFS=: read -r num rest; do
    is_suppressed "$rest" && continue
    is_comment "$rest" && continue
    trimmed=$(echo "$rest" | sed 's/^[[:space:]]*//')
    echo "  [INLINE_STRING] $file:$num — $trimmed" >> "$TMPFILE"
  done
}

# --- Check 3: Magic Numbers (webview-ui/**/*.tsx only) ---
check_magic_numbers() {
  local file="$1"
  if [ "${CHECK_TEST_MODE:-}" != "1" ]; then
    case "$file" in webview-ui/*.tsx) ;; *) return ;; esac
  else
    case "$file" in *.tsx) ;; *) return ;; esac
  fi

  local content
  content=$(get_content "$file") || return

  # Pixel dimensions with 2+ digits: '200px', '100px', '10px 12px'
  echo "$content" | grep -nE "[0-9]{2,}px" | while IFS=: read -r num rest; do
    is_suppressed "$rest" && continue
    is_comment "$rest" && continue
    trimmed=$(echo "$rest" | sed 's/^[[:space:]]*//')
    echo "  [MAGIC_NUMBER] $file:$num — $trimmed" >> "$TMPFILE"
  done

  # Comparison thresholds >= 10 (exclude .length)
  echo "$content" | grep -nE '(>|<|>=|<=|===|==|!==|!=)[[:space:]]*[0-9]{2,}' | while IFS=: read -r num rest; do
    is_suppressed "$rest" && continue
    is_comment "$rest" && continue
    case "$rest" in *.length*) continue ;; esac
    # Skip lines already caught by pixel check
    echo "$rest" | grep -qE '[0-9]{2,}px' && continue
    trimmed=$(echo "$rest" | sed 's/^[[:space:]]*//')
    echo "  [MAGIC_NUMBER] $file:$num — $trimmed" >> "$TMPFILE"
  done

  # .slice() with bounds >= 10
  echo "$content" | grep -nE '\.slice\([^)]*[0-9]{2,}' | while IFS=: read -r num rest; do
    is_suppressed "$rest" && continue
    is_comment "$rest" && continue
    trimmed=$(echo "$rest" | sed 's/^[[:space:]]*//')
    echo "  [MAGIC_NUMBER] $file:$num — $trimmed" >> "$TMPFILE"
  done
}

# --- Check 4: Misplaced // inline-ok after JSX closing > (.tsx only) ---
check_jsx_inline_ok() {
  local file="$1"
  case "$file" in *.tsx) ;; *) return ;; esac

  local content
  content=$(get_content "$file") || return

  # Match lines where > is followed by // inline-ok — renders as visible text
  echo "$content" | grep -nE '>[[:space:]]*//[[:space:]]*inline-ok' | while IFS=: read -r num rest; do
    trimmed=$(echo "$rest" | sed 's/^[[:space:]]*//')
    echo "  [JSX_TEXT_LEAK] $file:$num — '// inline-ok' after > renders as text. Use {/* inline-ok */} or place inside style object" >> "$TMPFILE"
  done
}

# --- Process each file ---
echo "$FILES" | while IFS= read -r file; do
  [ -z "$file" ] && continue
  is_excluded "$file" && continue
  check_colors "$file"
  check_strings "$file"
  check_magic_numbers "$file"
  check_jsx_inline_ok "$file"
done

VIOLATIONS=$(wc -l < "$TMPFILE" | tr -d ' ')

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "[inline-check] Found $VIOLATIONS inline coding standard violation(s):"
  echo ""
  cat "$TMPFILE"
  echo ""
  echo "  Colors  → webview-ui/src/config/colors.ts"
  echo "  Strings → webview-ui/src/config/strings.ts"
  echo "  Numbers → Promote to named constants"
  echo ""
  echo "  Suppress with: // inline-ok  or  {/* inline-ok */}"
  exit 1
fi

exit 0
