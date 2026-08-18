# 操作索引

本文件只用于从业务意图定位角色操作手册。命中角色后加载对应 `operations.md`，不要加载其他角色手册。

| 角色 | 操作域 | operationId 前缀 | 手册位置 |
|---|---|---|---|
| WEB_ADMIN | 管理员初始化、公司部门、内部成员、角色权限 | `admin.*` | `skills/web-admin/operations.md` |
| MANAGER | 名下客户、首次协议、材料、合同跟进、档案 | `manager.*` | `skills/manager/operations.md` |
| SENIOR_ADMIN (P9) | 本公司成员、高级客户范围、配置、模板审核 | `p9.*`, `senior.*` | `skills/p9/operations.md` |
| BRANCH_GENERAL_MANAGER (P8) | 授权下属树客户与合同读取、配置 | `p8.*`, `senior.*` | `skills/p8/operations.md` |
| SENIOR_MANAGER (P7) | 授权下属树客户与合同读取、配置 | `p7.*`, `senior.*` | `skills/p7/operations.md` |
| TRUST_SPECIALIST | 合同创建、审核、退回重签、归档、材料与模板 | `specialist.*` | `skills/specialist/operations.md` |
| OPERATIONS | 产品、档案分类、模板和资产模板 | `operations.*` | `skills/operations/operations.md` |
| CUSTOMER | 本人协议、材料、合同确认与签署 | `customer.*` | `skills/customer/operations.md` |

共享意图 `auth.*`、`todo.*`、`notification.*` 仍使用当前角色固定 Profile；不得借共享接口切换到更高权限身份。
