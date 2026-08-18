---
name: jiaban-manager
description: Handles isolated-test Jiaban customer-manager work with the dedicated MANAGER profile. Use when the user explicitly mentions 客户经理, P6经理, 后端显示P6经理, an assigned customer, customer service, or contract follow-up.
---

# Jiaban Manager

## Identity and scope

- Always use `--profile manager`; the Profile must belong only to the MANAGER test account.
- First run `jiaban --profile manager auth status` and require `activeRole=MANAGER`.
- “客户经理” is a UI alias and the backend may display “P6经理”; both map only to `MANAGER`.
- Never use or accept `CUSTOMER_MANAGER` or `P6_MANAGER` as an activeRole.
- Limit work to the explicitly named customer or the account's authorized assignment scope.

## Workflow

1. Never use the fixed senior customer or contract commands.
2. Use `jiaban --profile manager api request GET /api/manager/customers/<confirmed-id> --dry-run` for one customer.
3. Use `/api/manager/customers/<confirmed-id>/contract-flows` for that customer's flows and `/api/manager/contract-flows/<confirmed-id>` for one flow; dry-run before each read.
4. For a write, dry-run the exact manager route and obtain current-turn confirmation before adding `--yes`.
5. Use a fresh `--plan-id` for DELETE or high-risk paths.

Never enumerate customers to discover a target or switch role after 401/403. Follow the [CLI contract](../../references/cli-contract.md), [safety policy](../../references/safety-policy.md), and [role map](../../references/role-routing.md).
