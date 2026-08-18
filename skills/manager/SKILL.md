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
2. Load [MANAGER operations](operations.md), select one `operationId`, and collect its required inputs.
3. Follow [dialog state](../../references/dialog-state.md); dry-run the indexed route before reads or writes.
4. Writes require current-turn confirmation and `--yes`; R3/R4 require a fresh `--plan-id`. Follow [error policy](../../references/error-policy.md).

Never enumerate customers to discover a target or switch role after 401/403. Follow the [CLI contract](../../references/cli-contract.md) and [safety policy](../../references/safety-policy.md).
