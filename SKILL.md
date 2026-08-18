---
name: jiaban-router
description: Routes internal isolated-test Jiaban requests to eight role skills and guides secure WEB_ADMIN initialization through the shared CLI. Use when a user asks to query or operate Jiaban test business, or says 设置管理员账户 or 初始化管理员账户.
---

# Jiaban Role Router

## Boundary

- Use only dedicated accounts and test data in an isolated internal environment.
- Treat backend authorization, tenant scope, and data scope as final; `activeRole` is not a permission sandbox.
- Never request, copy, or display credentials during business operations. They must exist in deployment Secrets or an encrypted Profile.
- Every business command must explicitly include the role's fixed `--profile <name>`.

## WEB_ADMIN initialization

- Trigger only from an explicit request to set or initialize the administrator account in a private one-to-one test conversation.
- Pass the single strict `{phone,password}` JSON object to `jiaban admin init` through stdin; never place either value in argv, stdout, stderr, audit, or source.
- The CLI uses the fixed test origin, verifies login and `WEB_ADMIN` identity first, then atomically encrypts and activates Profile `web-admin`.
- On any failure, stop; do not retry with another role or persist an unverified Profile.

## Route

1. Extract the requested role, business target, action, and data scope.
2. Match exactly one row in [role-routing.md](references/role-routing.md).
3. If the request is ambiguous, especially “管理员”, “总经理”, or “高级经理”, ask for the exact role instead of selecting a more privileged role.
4. Use [operation index](references/operation-index.md) to locate the domain, then load only the matched role Skill and its local `operations.md`.
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

- Follow [dialog and parameter state](references/dialog-state.md), [error policy](references/error-policy.md), [CLI contract](references/cli-contract.md), and [safety policy](references/safety-policy.md) only when execution reaches those stages.
- Never invent an endpoint or parameter. If no indexed `operationId` matches, stop and report that the operation is not yet documented.
- Every generic request starts with dry-run. Writes require current-turn confirmation; R3/R4 require the current single-use plan.
- Return only the operation index's allowed minimum result.
