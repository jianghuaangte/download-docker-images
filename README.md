## 下载地址
https://jianghuaangte.github.io/download-docker-images/

## 网页界面（推荐）

打开上面的下载地址，在页面里：

1. 「镜像名称」每行填一个镜像
2. 填写「授权码」（Cloudflare Worker 校验用）
3. 若要拉取 `ghcr.io` 私有镜像，再填入「GitHub Token」；页面会触发 **私有仓库** 的工作流，结果上传到私有 Release，下载时同样需要该 Token
4. 点击「批量触发下载任务」
5. 打包完成后在右侧任务卡片里「检测文件」并下载（公开镜像支持 GitHub 加速地址，私有镜像直接由浏览器带 Token 下载；大文件自动分片）

### 两种触发方式

| 触发方式 | 授权码 | GitHub Token | 说明 |
| --- | --- | --- | --- |
| 私有镜像（推荐） | 必填 | 必填 | Worker 先校验授权码；通过后浏览器直连 GitHub API 触发 **私有仓库** 的工作流；Token 同时用于下载私有 Release 资产 |
| 公开镜像 | 必填 | 可留空 | 走原有的加速 Worker，触发公开仓库工作流，结果上传公开 Release |

### 仓库说明

| 仓库 | 用途 | 访问方式 |
| --- | --- | --- |
| `jianghuaangte/download-docker-images` | 公开镜像，上传公开 Release | 可匿名/加速下载 |
| `jianghangte/private-download-docker-images` | 私有镜像，上传私有 Release | 下载资产必须带 GitHub Token |

私有仓库的工作流文件：`.github/workflows/batch-pull-private-docker.yml`，由前端在填了 GitHub Token 时直接通过 `workflow_dispatch` 触发。

#### Worker 侧需要的改动

页面会先向 Worker 发送 `{ "key": "<授权码>", "validateOnly": true }`，只校验授权码、不触发工作流。请在 Worker 里增加 `validateOnly` 支持；参考实现已放在仓库 `worker/worker.js`。

如果 Worker 不支持 `validateOnly`，页面会拒绝提交并提示“需要为 Worker 增加 validateOnly 支持”，不做降级，以免授权码被绕过。

### Token 需要的权限

| 场景 | 所需权限 |
| --- | --- |
| 触发私有仓库工作流 | 经典 PAT 需要 `repo`、`workflow`；细粒度 PAT 需要 Actions 读写 |
| 下载私有 Release 资产 | 经典 PAT 需要 `repo`；细粒度 PAT 需要 Contents 读 |

- `workflow` 权限是触发 `workflow_dispatch` 所必需的
- Token 只在浏览器里使用，直接请求 `api.github.com`，不经过任何第三方服务，页面也不做持久化保存
- 运行结束后建议在 GitHub 设置中撤销或轮换该 Token

## gz文件
```shell=
docker load -i xxx.tar.gz
```

## part 分割文件
```shell
cat xxx.part.* > xxx.tar
docker load -i xxx.tar
```

## 在 GitHub Actions 界面手动触发

`Actions` → `Batch Pull and Package Docker Images` → `Run workflow`，参数如下：

| 参数 | 说明 |
| --- | --- |
| `images` | 镜像列表，每行一个，支持带仓库前缀的完整名称 |
| `ghcr_login` | 是否登录 ghcr.io，默认开启；只拉取公开镜像时可关闭 |
| `ghcr_username` | ghcr.io 用户名，留空则依次回退到 `GHCR_USERNAME` 密钥、触发工作流的账号 |
| `ghcr_token` | 本次运行使用的 GitHub Token，留空则依次回退到 `GHCR_TOKEN` 密钥、内置 `GITHUB_TOKEN` |

`images` 示例：

```
ghcr.io/owner/private-image:v1.0.0
ghcr.io/home-assistant/home-assistant:stable
docker.io/library/nginx:latest
```

### 可选：把 Token 存成仓库密钥

不想每次输入 Token 时，可以在 `Settings` → `Secrets and variables` → `Actions` 里添加：

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `GHCR_TOKEN` | 否 | 带 `read:packages` 权限的 PAT，`ghcr_token` 参数留空时使用 |
| `GHCR_USERNAME` | 否 | ghcr.io 用户名，默认使用触发工作流的 GitHub 账号 |

> 内置的 `GITHUB_TOKEN` 只能访问本仓库/本组织可见的包。
> 拉取**其他仓库或其他用户的私有包**时，必须提供带 `read:packages` 权限的 PAT。

## 说明

- 登录只影响 `ghcr.io`，Docker Hub 等其他仓库的拉取行为不变。
- 工作流已声明 `packages: read` 权限，`GITHUB_TOKEN` 回退模式依赖该权限。
- 通过 `ghcr_token` 参数传入的 Token 会在日志中被 `::add-mask::` 打码，但仍会出现在本次运行的输入记录里，因此不要用于共享仓库。
