---
name: jiaban-web-admin
description: Handles isolated-test Jiaban backend administration with the dedicated WEB_ADMIN profile. Use when the user explicitly mentions 后台管理员, Web管理员, 后台用户, roles, permissions, or organization configuration.
---

# Jiaban Web Admin

## Identity and scope

- Always use `--profile web-admin`; the Profile must belong only to the WEB_ADMIN test account.
- First run `jiaban --profile web-admin auth status` and require `activeRole=WEB_ADMIN`.
- Limit work to the specifically named test user, role, permission, or organization object.
- Do not route generic “管理员” here until the user distinguishes WEB_ADMIN from P9 SENIOR_ADMIN.

## Workflow

1. Resolve one exact backend object and confirmed `/api/**` route.
2. For a read, run `jiaban --profile web-admin api request GET /api/<confirmed-path> --dry-run`, review it, then run the same command without `--dry-run`.
3. For a write, dry-run the exact request and obtain the user's specific current-turn confirmation before adding `--yes`.
4. Treat permissions, status changes, password reset, approval, and DELETE as high risk and use the returned single-use `--plan-id`.

Never change roles or broaden user/organization scope after 401/403. Follow the [CLI contract](../../references/cli-contract.md), [safety policy](../../references/safety-policy.md), and [role map](../../references/role-routing.md).
