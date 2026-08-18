---
name: jiaban-operations
description: Handles isolated-test Jiaban product-manager work with the dedicated OPERATIONS profile. Use when the user explicitly mentions 产品经理, 运营产品岗位, product pool, product configuration, operational publishing, or product materials.
---

# Jiaban Product Operations

## Identity and scope

- Always use `--profile operations`; the Profile must belong only to the OPERATIONS test account.
- First run `jiaban --profile operations auth status` and require `activeRole=OPERATIONS`.
- “产品经理” is the UI/business name but maps only to backend role `OPERATIONS`.
- Never use or accept `PRODUCT_MANAGER` as an activeRole.
- Limit work to the named product, version, material, or publication target.

## Workflow

1. Load [OPERATIONS operations](operations.md), select one `operationId`, and collect every required input.
2. Follow [dialog state](../../references/dialog-state.md); dry-run the indexed route before reads or writes.
3. Writes need current-turn confirmation; R3/R4 need a fresh `--plan-id`. Follow [error policy](../../references/error-policy.md).
4. Report only fields listed by the selected operation and needed for the question.

Never publish from a prior confirmation or switch to an admin role after 401/403. Follow the [CLI contract](../../references/cli-contract.md) and [safety policy](../../references/safety-policy.md).
