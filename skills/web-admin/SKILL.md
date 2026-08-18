---
name: jiaban-web-admin
description: Handles isolated-test Jiaban backend administration and secure setup of its dedicated WEB_ADMIN profile. Use when the user explicitly mentions 后台管理员, Web管理员, 设置管理员账户, 初始化管理员账户, roles, permissions, or organization configuration.
---

# Jiaban Web Admin

## Identity and scope

- Always use `--profile web-admin`; the Profile must belong only to the WEB_ADMIN test account.
- First run `jiaban --profile web-admin auth status` and require `activeRole=WEB_ADMIN`.
- Limit work to the specifically named test user, role, permission, or organization object.
- Do not route generic “管理员” here until the user distinguishes WEB_ADMIN from P9 SENIOR_ADMIN.

## Workflow

1. For explicit administrator initialization in a private one-to-one test conversation, send strict `{phone,password}` JSON to `jiaban admin init` through stdin only. Never put credentials in argv or output.
2. The command must verify login and `activeRole=WEB_ADMIN` before encrypted Profile `web-admin` becomes active; stop on any failure.
3. Load [WEB_ADMIN operations](operations.md), select exactly one `operationId`, and collect every listed required input before any request.
4. Follow [dialog state](../../references/dialog-state.md). For a write, dry-run the indexed method/path and obtain specific current-turn confirmation before `--yes`.
5. R3/R4 operations require the returned single-use `--plan-id`; use [error policy](../../references/error-policy.md) on failure.

Never change roles or broaden user/organization scope after 401/403. Follow the [CLI contract](../../references/cli-contract.md) and [safety policy](../../references/safety-policy.md).
