---
name: jiaban-p9
description: Handles isolated-test Jiaban P9 general-manager work with the dedicated SENIOR_ADMIN profile. Use when the user explicitly mentions P9总经理, P9高级管理, the current company, or its backend-authorized management chain.
---

# Jiaban P9 General Manager

## Identity and scope

- Always use `--profile p9`; the Profile must belong only to the SENIOR_ADMIN test account.
- First run `jiaban --profile p9 auth status` and require `activeRole=SENIOR_ADMIN`.
- Do not route plain “管理员” or “总经理” here without explicit P9 clarification.
- Company-level visibility remains limited to the backend-authorized management chain and does not authorize unrelated records.

## Workflow

1. Load [P9 operations](operations.md), select exactly one `operationId`, and collect every required input.
2. Use fixed senior reads only when they exactly implement the indexed read and the ID is confirmed.
3. Follow [dialog state](../../references/dialog-state.md); writes need current-turn confirmation, and R3/R4 need a fresh `--plan-id`.
4. Follow [error policy](../../references/error-policy.md); known backend contract gaps in the operation index are stop conditions.

Never select P9 merely because another role is ambiguous or returns 401/403. Follow the [CLI contract](../../references/cli-contract.md) and [safety policy](../../references/safety-policy.md).
