# P9 操作索引

通用写操作由Agent固定生成 `--reason internal-test:<operationId>`，dry-run与执行使用同一值，不向用户索要reason或工单；用户仍须在当前回合确认，R3/R4仍须单次plan。

| operationId | Method / Path | 必填输入 | 约束 / 风险 |
|---|---|---|---|
| `p9.company.departments` | GET `/api/senior/company/departments/tree` | 无 | 仅本公司；R1 |
| `p9.company.users` | GET `/api/senior/company/users` | 无 | 仅本公司内部员工；R1 |
| `p9.company.user.update` | PUT `/api/senior/company/users/{id}` | `id`及完整用户字段 | 同公司且非WEB_ADMIN/CUSTOMER；R4 |
| `p9.company.user.status` | PUT `/api/senior/company/users/{id}/status` | `id,status` | R3 |
| `senior.customer.list` | GET `/api/senior/customers` | 明确的合法管理清单用途 | P9仅本公司；不得用来猜目标；R1 |
| `senior.customer.get` | GET `/api/senior/customers/{id}` | `id` | 本公司；R1 |
| `p9.customer.transfer` | PUT `/api/senior/customers/{id}` | `id,phone,displayName,managerUserId` | 仅P9；会迁移归属及流程；R4 |
| `senior.contract.list` | GET `/api/senior/customers/{id}/contract-flows` | 客户`id` | R1 |
| `senior.contract.config` | POST `/api/senior/contract-flows/{id}/config` | 流程`id`及配置 | 首登通过、状态和资料满足；R3 |
| `p9.agreement.approve` | POST `/api/senior/customers/{id}/first-login-agreement/approve` | 客户`id` | PENDING_REVIEW；R3 |
| `p9.agreement.reject` | POST `/api/senior/customers/{id}/first-login-agreement/reject` | 客户`id,comment` | 原因必填；R3 |
| `p9.template.approve` | POST `/api/senior/contract-templates/{id}/approve` | 模板`id` | 仅P9、PENDING_REVIEW；R3 |
| `p9.template.reject` | POST `/api/senior/contract-templates/{id}/reject` | 模板`id` | `reviewComment`建议明确；R3 |

已知约束：`/api/senior/contract-flows/{id}/forward-customer` 当前服务层按 MANAGER 办理人校验，普通P9通常403，手册不路由该操作。组织关系接口会返回全局启用组织节点，暂不用于P9范围推断。
