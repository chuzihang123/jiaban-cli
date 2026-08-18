---
name: jiaban-p8
description: Handles isolated-test Jiaban P8 branch leadership with the dedicated BRANCH_GENERAL_MANAGER profile. Use when the user explicitly mentions P8高级经理, 分公司总经理, an authorized subordinate tree, configuration, or transfer.
---

# Jiaban P8 Branch General Manager

## Identity and scope

- Always use `--profile p8`; the Profile must belong only to the BRANCH_GENERAL_MANAGER test account.
- First run `jiaban --profile p8 auth status` and require `activeRole=BRANCH_GENERAL_MANAGER`.
- Do not route plain “总经理” or “高级经理” here until P8 or branch scope is explicit.
- Keep every request inside the backend-authorized subordinate tree.

## Workflow

1. Load [P8 operations](operations.md), select one `operationId`, and collect every required input.
2. Use fixed senior reads only for an indexed read and confirmed ID inside the authorized subordinate tree.
3. Follow [dialog state](../../references/dialog-state.md); writes need current-turn confirmation, and R3/R4 need a fresh `--plan-id`.
4. Follow [error policy](../../references/error-policy.md); do not improvise an unindexed approval or transfer.

Never expand from one branch to all branches or switch to P9 after 401/403. Follow the [CLI contract](../../references/cli-contract.md) and [safety policy](../../references/safety-policy.md).
