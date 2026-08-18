---
name: jiaban-router
description: Routes internal isolated-test Jiaban requests to one of eight role skills through the shared secured CLI. Use when a user asks in natural language to query or operate Jiaban test business by role, profile, or business target.
---

# Jiaban Role Router

## Boundary

- Use only dedicated accounts and test data in an isolated internal environment.
- Treat backend authorization, tenant scope, and data scope as final; `activeRole` is not a permission sandbox.
- Never request, copy, display, or persist credentials. They must already exist in deployment Secrets or an encrypted Profile.
- Every business command must explicitly include the role's fixed `--profile <name>`.

## Route

1. Extract the requested role, business target, action, and data scope.
2. Match exactly one row in [role-routing.md](references/role-routing.md).
3. If the request is ambiguous, especially “管理员”, “总经理”, or “高级经理”, ask for the exact role instead of selecting a more privileged role.
4. Load only the matched role Skill below and follow it with [CLI contract](references/cli-contract.md) and [safety policy](references/safety-policy.md).
5. If the selected Profile reports a different `activeRole`, stop. Never switch identity to overcome 401/403.

## Role Skills

- 后台管理员 `WEB_ADMIN`: [web-admin](skills/web-admin/SKILL.md)
- 客户经理／P6经理 `MANAGER`: [manager](skills/manager/SKILL.md)
- P9总经理 `SENIOR_ADMIN`: [p9](skills/p9/SKILL.md)
- P8高级经理／分公司总经理 `BRANCH_GENERAL_MANAGER`: [p8](skills/p8/SKILL.md)
- P7高级经理 `SENIOR_MANAGER`: [p7](skills/p7/SKILL.md)
- 信托专员 `TRUST_SPECIALIST`: [specialist](skills/specialist/SKILL.md)
- 产品经理 `OPERATIONS`: [operations](skills/operations/SKILL.md)
- 客户 `CUSTOMER`: [customer](skills/customer/SKILL.md)

## Universal execution rules

- Prefer a fixed read-only CLI command only when the matched role is eligible under the CLI contract and it exactly covers the request.
- Every generic API request starts with `--dry-run` and uses only the confirmed `/api/**` path.
- A write requires the user's specific confirmation in the current turn before adding `--yes`.
- DELETE and high-risk paths require the CLI's current single-use `--plan-id`.
- Do not broaden IDs, paths, query ranges, files, roles, tenants, or profiles.
- Return only the minimum result needed for the request.
