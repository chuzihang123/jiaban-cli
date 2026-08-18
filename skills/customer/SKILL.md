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

1. Never use the fixed senior customer or contract commands; use only `/api/mobile/customer/**` routes.
2. Dry-run `jiaban --profile customer api request GET /api/mobile/customer/<confirmed-path> --dry-run` before the matching read.
3. Customer signing is routed only here. Dry-run the exact signing or other customer write and obtain current-turn confirmation before adding `--yes`.
4. Signing, status changes, withdrawal, replacement, and DELETE require a fresh `--plan-id`.

Never switch to MANAGER or an admin Profile after 401/403 or unavailable data. Follow the [CLI contract](../../references/cli-contract.md), [safety policy](../../references/safety-policy.md), and [role map](../../references/role-routing.md).
