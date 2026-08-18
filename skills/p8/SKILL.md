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

1. Use fixed senior reads only for confirmed IDs inside the authorized subordinate tree.
2. Otherwise dry-run `jiaban --profile p8 api request GET /api/<confirmed-path> --dry-run` before the matching read.
3. For a real endpoint that configures or transfers an authorized subordinate object, dry-run the exact request and obtain current-turn confirmation before adding `--yes`.
4. Status, permissions, archive, transfer, and DELETE require a fresh `--plan-id`.

Never expand from one branch to all branches or switch to P9 after 401/403. Follow the [CLI contract](../../references/cli-contract.md), [safety policy](../../references/safety-policy.md), and [role map](../../references/role-routing.md).
