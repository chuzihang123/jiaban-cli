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

1. Use fixed senior reads only for confirmed IDs inside the authorized subordinate tree.
2. Otherwise dry-run `jiaban --profile p7 api request GET /api/<confirmed-path> --dry-run` before the matching read.
3. For a real endpoint that configures or transfers an authorized subordinate object, dry-run the exact request and obtain current-turn confirmation before adding `--yes`.
4. Status, permissions, archive, transfer, and DELETE require a fresh `--plan-id`.

Never broaden team scope or switch to P8/P9 after 401/403. Follow the [CLI contract](../../references/cli-contract.md), [safety policy](../../references/safety-policy.md), and [role map](../../references/role-routing.md).
