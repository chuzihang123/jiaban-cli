# MANAGER 操作索引

| operationId | Method / Path | 必填输入 | 可选/默认 | 范围与风险 |
|---|---|---|---|---|
| `manager.customer.get` | GET `/api/manager/customers/{id}` | `id` | 无 | 仅本人直接归属客户；R1 |
| `manager.customer.create` | POST `/api/manager/customers` | `phone,displayName` | `riskLevel=UNASSESSED,status=ACTIVE` | 自动绑定当前经理；创建登录账号，R3 |
| `manager.customer.update` | PUT `/api/manager/customers/{id}` | `id,phone,displayName` | 风险/状态空则沿用 | 仅本人客户；R3 |
| `manager.agreement.get` | GET `/api/manager/customers/{customerId}/first-login-agreement` | `customerId` | 无 | R1 |
| `manager.agreement.approve` | POST `/api/manager/customers/{customerId}/first-login-agreement/approve` | `customerId` | `comment=Approved` | 仅PENDING_REVIEW；R3 |
| `manager.agreement.reject` | POST `/api/manager/customers/{customerId}/first-login-agreement/reject` | `customerId,comment` | 无 | 驳回原因必填；R3 |
| `manager.material.list` | GET `/api/manager/customers/{customerId}/materials` | `customerId` | 无 | R1 |
| `manager.material.upload` | POST `/api/manager/material-tasks/{taskId}/upload` multipart | `taskId,file` | 分类、标题 | 仅待上传/驳回；R2 |
| `manager.material.submit` | POST `/api/manager/material-tasks/{taskId}/submit-review` | `taskId` | 无 | R3 |
| `manager.contract.list` | GET `/api/manager/customers/{customerId}/contract-flows` | `customerId` | 无 | 本人客户；R1 |
| `manager.contract.get` | GET `/api/manager/contract-flows/{id}` | `id` | 无 | R1 |
| `manager.contract.config` | POST `/api/manager/contract-flows/{id}/config` JSON或multipart | `id`; Skill强约束request字段`productId,specificConfigAdvice,strategyAllocationsJson,allocationElementsJson`，其中两个AllocationsJson值必须是JSON编码字符串而非直接数组 | ContractFlowActionRequest完整11字段为`comment,customerId,productId,configTitle,managerSupplement,specificConfigAdvice,strategyAllocationsJson,allocationElementsJson,trustSpvPackageFlowId,trustSpvPackageFlowIds,reinvestWithoutPayment`；无附件用`--json-stdin`；有附件必须multipart：`--form request=<JSON-string>`且request值是完整JSON字符串，重复`--upload approvalFiles=<absolute-path>`；偏离收益率时审批附件必填；R3 |
| `manager.contract.forward` | POST `/api/manager/contract-flows/{id}/forward-customer` | `id` | `comment` | 状态必须允许；R3 |
| `manager.contract.return-four-docs` | POST `/api/manager/contract-flows/{id}/return-four-docs` | `id` | `comment` | R3 |
| `manager.archive.upload` | POST `/api/archive/manager/upload` multipart | `file,customerId,archiveCategoryId,archiveClassificationId` | archiveTitle/visibleToCustomer | 本人客户；进入档案域，R3 |

所有写操作写后用精确客户、材料任务或流程ID查询状态；网络失败不重放。
