# P8 操作索引

| operationId | Method / Path | 必填输入 | 范围 / 风险 |
|---|---|---|---|
| `senior.customer.list` | GET `/api/senior/customers` | 合法管理清单用途 | 仅本人授权下属owner树；R1 |
| `senior.customer.get` | GET `/api/senior/customers/{id}` | `id` | 授权下属树；R1 |
| `senior.contract.list` | GET `/api/senior/customers/{id}/contract-flows` | 客户`id` | R1 |
| `senior.contract.get` | GET `/api/senior/contract-flows/{id}` | 流程`id` | R1 |
| `senior.contract.config` | POST `/api/senior/contract-flows/{id}/config` | 流程`id`及配置 | 需权限、首登通过和正确状态；R3 |
| `senior.contract.preview` | POST `/api/senior/contract-flows/{id}/config/preview` | 流程`id`及配置 | 只生成PDF、不提交；R1型POST，仍需CLI写确认 |

P8没有本公司成员维护入口，也不宣称审批权或客户转移权。不要调用已知通常403的 senior `forward-customer`，不要用全局组织关系接口推断范围。
