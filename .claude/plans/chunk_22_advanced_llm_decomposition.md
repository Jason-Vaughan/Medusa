# Build Plan - Chunk 22: Advanced LLM Decomposition

## Objective
Replace the current mock decomposition rules in the `DecompositionEngine` with actual LLM calls (Anthropic or OpenAI) to enable more intelligent and flexible task splitting across the swarm.

## Key Files & Context
- `src/a2a_node/app/core/decomposition.py`: The core logic for splitting tasks.
- `src/a2a_node/app/core/config.py`: Configuration for LLM API keys and model selection.
- `src/a2a_node/app/core/security.py`: Ensuring API keys are handled securely.
- `src/a2a_node/app/api/a2a.py`: Where the decomposition engine is invoked.

## Implementation Steps
1.  **Environment Configuration:** Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to `src/a2a_node/app/core/config.py`.
2.  **LLM Client Implementation:** Create a new utility to handle LLM completions in the A2A node.
3.  **Refactor DecompositionEngine:**
    *   Update `decompose_task` to use the LLM client.
    *   Design a robust prompt for the LLM to return structured JSON (sub-tasks and dependencies).
    *   Implement fallback to mock rules if LLM fails or is unavailable.
4.  **Schema Support:** Ensure `TaskEntry` and `LedgerTask` properly handle the sub-task structure returned by the LLM.
5.  **Integration Testing:** Test with complex task descriptions to verify intelligent splitting.

## Verification & Testing
- **Unit Tests:** Verify the prompt generation and JSON parsing logic.
- **Integration Tests:** Run the A2A node with a real (or mocked) LLM provider and confirm tasks are decomposed correctly in the ledger.
- **Dashboard Check:** Verify that the task tree on the Switchboard correctly displays the LLM-generated sub-tasks.

## Migration & Rollback
- No DB migration expected for this chunk (schema already supports sub-tasks).
- Rollback: Revert to mock decomposition rules via configuration toggle.
