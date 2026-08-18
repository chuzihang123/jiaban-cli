---
name: jiaban-specialist
description: Handles isolated-test Jiaban trust-specialist workflow work with the dedicated TRUST_SPECIALIST profile. Use when the user explicitly mentions 信托专员, 信托业务专员, workflow creation, review, return for re-signing, or archiving.
---

# Jiaban Trust Specialist

## Identity and scope

- Always use `--profile specialist`; the Profile must belong only to the TRUST_SPECIALIST test account.
- First run `jiaban --profile specialist auth status` and require `activeRole=TRUST_SPECIALIST`.
- Limit work to the named customer, contract flow, task, or material.
- This role may create, review, return for customer re-signing, and archive only within backend authorization. The customer performs the signature.

## Workflow

1. Never use the fixed senior contract commands.
2. Use `jiaban --profile specialist api request GET /api/specialist/contract-flows --dry-run` for the authorized list or `/api/specialist/contract-flows/<confirmed-id>` for one flow.
3. For create, review, return-for-re-signing, or archive writes, dry-run the exact specialist route and obtain current-turn confirmation before adding `--yes`.
4. Return, archive, status changes, and DELETE require a fresh `--plan-id`.

Never claim signature authority or use another role after 401/403. Follow the [CLI contract](../../references/cli-contract.md), [safety policy](../../references/safety-policy.md), and [role map](../../references/role-routing.md).
