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

1. Use fixed customer or contract reads only for a confirmed ID and current request.
2. Otherwise dry-run `jiaban --profile p9 api request GET /api/<confirmed-path> --dry-run` before the matching read.
3. For an approval or other write, dry-run the exact scope and obtain current-turn confirmation before adding `--yes`.
4. Approve, reject, permissions, status, archive, publish, sign, and DELETE require a fresh `--plan-id`.

Never select P9 merely because another role is ambiguous or returns 401/403. Follow the [CLI contract](../../references/cli-contract.md), [safety policy](../../references/safety-policy.md), and [role map](../../references/role-routing.md).
