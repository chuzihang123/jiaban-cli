# P7 操作索引

通用写操作由Agent固定生成 `--reason internal-test:<operationId>`，dry-run与执行使用同一值，不向用户索要reason或工单；用户仍须在当前回合确认，R3/R4仍须单次plan。

| operationId | Method / Path | 必填输入 | 范围 / 风险 |
|---|---|---|---|
| `senior.customer.list` | GET `/api/senior/customers` | 合法管理清单用途 | 仅本人授权下属owner树；R1 |
| `senior.customer.get` | GET `/api/senior/customers/{id}` | `id` | 授权下属树；R1 |
| `senior.contract.list` | GET `/api/senior/customers/{id}/contract-flows` | 客户`id` | R1 |
| `senior.contract.get` | GET `/api/senior/contract-flows/{id}` | 流程`id` | R1 |
| `senior.contract.config` | POST `/api/senior/contract-flows/{id}/config` | 流程`id`及配置 | 需权限、首登通过和正确状态；R3 |
| `senior.contract.preview` | POST `/api/senior/contract-flows/{id}/config/preview` | 流程`id`及配置 | 只生成PDF、不提交；R1型POST，仍需CLI写确认 |

P7不维护公司成员，不宣称审批权或客户转移权。不要调用已知通常403的 senior `forward-customer`，不要用全局组织关系接口推断范围。
