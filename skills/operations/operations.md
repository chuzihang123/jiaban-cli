# OPERATIONS 操作索引

| operationId | Method / Path | 必填输入 | 可选 / 范围与风险 |
|---|---|---|---|
| `operations.product.list` | GET `/api/operations/products` | 合法产品清单用途 | R1，不用于猜目标 |
| `operations.product.get` | GET `/api/operations/products/{id}` | `id` | R1 |
| `operations.product.create` | POST `/api/operations/products` | `productName,productType` | productCode自动、status默认ACTIVE；R2 |
| `operations.product.update` | PUT `/api/operations/products/{id}` | `id,productName,productType` | R2 |
| `operations.product.config-file` | PUT `/api/operations/products/{id}/config-file` | `id,configFile` | R3 |
| `operations.product.status` | PUT `/api/operations/products/{id}/status` | `id,status` | R3 |
| `operations.product.delete` | DELETE `/api/operations/products/{id}` | `id` | R4 |
| `operations.archive-category.list` | GET `/api/operations/archive-categories/tree` | 无 | R1 |
| `operations.archive-category.create` | POST `/api/operations/archive-categories` | `categoryCode,categoryName` | sort可选；code仅数字；R3 |
| `operations.archive-category.update` | PUT `/api/operations/archive-categories/{id}` | `id,categoryCode,categoryName` | sort可选；R3 |
| `operations.archive-category.status` | PUT `/api/operations/archive-categories/{id}/status` | `id,status=ENABLED|DISABLED` | R3 |
| `operations.archive-classification.create` | POST `/api/operations/archive-classifications` | `categoryId,classificationCode,classificationName` | sort可选；R3 |
| `operations.archive-classification.update` | PUT `/api/operations/archive-classifications/{id}` | `id,categoryId,classificationCode,classificationName` | sort可选；R3 |
| `operations.archive-classification.status` | PUT `/api/operations/archive-classifications/{id}/status` | `id,status=ENABLED|DISABLED` | R3 |
| `operations.archive.classify` | PUT `/api/operations/archives/{documentId}/classification` | `documentId,archiveCategoryId,archiveClassificationId` | archiveTitle/comment可选；R3 |
| `operations.archive.finalize` | POST `/api/operations/archives/{documentId}/archive` | `documentId,visibleToCustomer` | comment可选；R3 |
| `operations.service-template.create` | POST `/api/admin/service-plan-templates` | `templateName` | serviceLevel/summary可选；R3 |
| `operations.service-template.update` | PUT `/api/admin/service-plan-templates/{id}` | `id,templateName` | serviceLevel/summary可选；R3 |
| `operations.service-template.status` | PUT `/api/admin/service-plan-templates/{id}/status` | `id,status` | R3 |
| `operations.agreement-template.create` | POST `/api/admin/service-agreement-templates` | `templateName,content` | agreementType/fieldConfigJson/signatureEnabled/signatureConfigJson可选；R3 |
| `operations.agreement-template.update` | PUT `/api/admin/service-agreement-templates/{id}` | `id,templateName,content` | 同上；R3 |
| `operations.agreement-template.status` | PUT `/api/admin/service-agreement-templates/{id}/status` | `id,status` | R3 |
| `operations.agreement-template.delete` | DELETE `/api/admin/service-agreement-templates/{id}` | `id` | R4 |
| `operations.asset-template.submit` | PUT `/api/admin/asset-templates` | 非空`templates[]` | 保存为PENDING_REVIEW；R3 |

写后精确读取产品、分类、档案或模板状态；不得自动发布或扩大到全部产品。
