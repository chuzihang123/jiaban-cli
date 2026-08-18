---
name: jiaban-customer
description: Handles isolated-test Jiaban customer self-service with the dedicated CUSTOMER profile. Use when the user explicitly identifies as 客户本人 or asks about 我的合同, 我的材料, 我的进度, or their own test account.
---

# Jiaban Customer

## Identity and scope

- Always use `--profile customer`; the Profile must belong only to the CUSTOMER test account.
- First run `jiaban --profile customer auth status` and require `activeRole=CUSTOMER`.
- Access only the authenticated customer's own account and backend-authorized records.
- Never accept another customer's ID as authority and never enumerate customers.

## Workflow

1. Never use fixed senior commands; load [CUSTOMER operations](operations.md) and select one `operationId` under `/api/mobile/customer/**`.
2. Collect every required input and follow [dialog state](../../references/dialog-state.md).
3. Customer signing is routed only here. Writes need current-turn confirmation; R3/R4 need a fresh `--plan-id`.
4. Follow [error policy](../../references/error-policy.md) and return only the current customer's minimum result.

Never switch to MANAGER or an admin Profile after 401/403 or unavailable data. Follow the [CLI contract](../../references/cli-contract.md) and [safety policy](../../references/safety-policy.md).
