---
name: jiaban-p7
description: Handles isolated-test Jiaban P7 senior-manager work with the dedicated SENIOR_MANAGER profile. Use when the user explicitly mentions P7高级经理, an authorized subordinate tree, configuration, transfer, or team follow-up.
---

# Jiaban P7 Senior Manager

## Identity and scope

- Always use `--profile p7`; the Profile must belong only to the SENIOR_MANAGER test account.
- First run `jiaban --profile p7 auth status` and require `activeRole=SENIOR_MANAGER`.
- Do not route plain “高级经理” here until P7 is explicit.
- Limit work to the backend-authorized subordinate tree and named business object.

## Workflow

1. Load [P7 operations](operations.md), select one `operationId`, and collect every required input.
2. Use fixed senior reads only for an indexed read and confirmed ID inside the authorized subordinate tree.
3. Follow [dialog state](../../references/dialog-state.md); writes need current-turn confirmation, and R3/R4 need a fresh `--plan-id`.
4. Follow [error policy](../../references/error-policy.md); do not improvise an unindexed approval or transfer.

Never broaden team scope or switch to P8/P9 after 401/403. Follow the [CLI contract](../../references/cli-contract.md) and [safety policy](../../references/safety-policy.md).
