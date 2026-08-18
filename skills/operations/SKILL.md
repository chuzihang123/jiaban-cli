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

1. Resolve one confirmed product endpoint and dry-run `jiaban --profile operations api request GET /api/<confirmed-path> --dry-run` before a read.
2. For product configuration or publication writes, dry-run the exact request and obtain current-turn confirmation before adding `--yes`.
3. Publish, status, archive, replace, approve, reject, and DELETE require a fresh `--plan-id`.
4. Report only fields needed to answer the product question.

Never publish from a prior confirmation or switch to an admin role after 401/403. Follow the [CLI contract](../../references/cli-contract.md), [safety policy](../../references/safety-policy.md), and [role map](../../references/role-routing.md).
