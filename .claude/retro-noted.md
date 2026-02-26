# Retro Notes

- IDEA: Sub-agent child resolution duplicated in ConversationBuilder — extract shared `getChildIds(parentId, sessions)` helper used by both `getFilteredConversation()` and `getFilteredConversationForGroup()` (files: `src/monitoring/ConversationBuilder.ts`)
