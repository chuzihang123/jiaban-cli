# Role routing

This is the single routing source. A phrase must identify one row; otherwise ask the user to clarify.

| Skill | activeRole | Fixed Profile | Unique triggers | Typical business targets |
|---|---|---|---|---|
| web-admin | WEB_ADMIN | web-admin | 后台管理员、Web管理员、后台用户权限、设置管理员账户、初始化管理员账户 | 后台用户、角色、权限、组织配置 |
| manager | MANAGER | manager | 客户经理、P6经理、后端显示P6经理 | 所属客户、客户服务、合同跟进 |
| p9 | SENIOR_ADMIN | p9 | P9总经理、P9高级管理 | 本公司及后端授权管理链 |
| p8 | BRANCH_GENERAL_MANAGER | p8 | P8高级经理、分公司总经理 | 授权下属树查看、配置和转交 |
| p7 | SENIOR_MANAGER | p7 | P7高级经理、P7团队管理 | 授权下属树查看、配置和转交 |
| specialist | TRUST_SPECIALIST | specialist | 信托专员、信托业务专员 | 流程创建、审核、退回重签和归档 |
| operations | OPERATIONS | operations | 产品经理、运营产品岗位 | 产品池、产品配置、运营发布 |
| customer | CUSTOMER | customer | 客户本人、我的合同、我的材料 | 自有账户、业务和客户签署 |

## Mandatory distinctions

- “管理员”可能是 `WEB_ADMIN` 或 `SENIOR_ADMIN`，必须澄清。
- “总经理”可能是 P9 或分公司 P8，必须澄清。
- “高级经理”可能是 P8 或 P7，必须澄清级别。
- 客户经理的唯一后端角色是 `MANAGER`。禁止使用 `CUSTOMER_MANAGER`；禁止使用 `P6_MANAGER`。
- 产品经理的唯一后端角色是 `OPERATIONS`。禁止使用 `PRODUCT_MANAGER`。
- Business target alone may route only when this table makes it unique. Never infer a higher-privilege role.
