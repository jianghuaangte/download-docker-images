## 下载地址
https://jianghuaangte.github.io/download-docker-images/

## 网页界面（推荐）

打开上面的下载地址，在页面里：

1. 「镜像名称」每行填一个镜像（`#` 开头的行会被忽略）
2. 填写「授权码」（Cloudflare Worker 校验用）
3. 选择「打包格式」：`tar`（默认，原始包，下载后直接 `docker load`）或 `tar.gz`（压缩，体积最小）
4. 若要拉取 `ghcr.io` 私有镜像，再填入「GitHub Token」；页面会触发 **私有仓库** 的工作流，结果上传到私有 Release，下载时同样需要该 Token
5. 点击「批量触发下载任务」
6. 打包完成后在右侧任务卡片里「检测文件」并下载（公开镜像支持 GitHub 加速地址，私有镜像直接由浏览器带 Token 下载；大文件自动分片）

格式选择会记在浏览器 localStorage，下次打开沿用上次的值；切换后已有任务卡片会重新检测文件。

### 两种触发方式

| 触发方式 | 授权码 | GitHub Token | 说明 |
| --- | --- | --- | --- |
| 私有镜像（推荐） | 必填 | 必填 | Worker 先校验授权码；通过后浏览器直连 GitHub API 触发 **私有仓库** 的工作流；Token 同时用于下载私有 Release 资产 |
| 公开镜像 | 必填 | 可留空 | 走加速 Worker，触发公开仓库工作流，结果上传公开 Release |

### 仓库说明

| 仓库 | 用途 | 访问方式 |
| --- | --- | --- |
| `jianghuaangte/download-docker-images` | 公开镜像，上传公开 Release | 可匿名/加速下载 |
| `jianghuaangte/private-download-docker-images` | 私有镜像，上传私有 Release | 下载资产必须带 GitHub Token |

私有仓库的工作流文件：`.github/workflows/batch-pull-private-docker.yml`，由前端在填了 GitHub Token 时直接通过 `workflow_dispatch` 触发。

## 打包格式是怎么传给 Actions 的

`workflow_dispatch` 的 `inputs` 只接受工作流里声明过的字段，所以两个工作流都声明了一个 `format` 选项：

```yaml
format:
  type: choice
  options: [tar, tar.gz]
  default: tar
```

- **公开路径**：页面把 `{ images, key, format }` POST 给 Worker，Worker 校验授权码后把 `format` 一并放进 dispatch 的 `inputs`
- **私有路径**：页面拿到授权码校验通过后，用 PAT 直连 GitHub API，直接把 `format` 放进 `inputs`

所以 `worker/worker.js` 需要支持并转发 `format`（仓库里已经是这个版本）。它只放行 `tar` / `tar.gz`，其他值回退 `tar`，避免脏值让 GitHub 返回 `422`。

### 部署顺序

`workflow_dispatch` 不接受工作流未声明的 input，所以改格式相关的东西时要：

1. 先推 `.github/workflows/*.yml`
2. 再粘 `worker/worker.js` 到 Cloudflare Worker 编辑器保存部署

顺序反了会出现 `422 Unexpected inputs provided`。

### 如果 Worker 还是旧版本

旧 Worker 不转发 `format`，公开路径会按默认 `tar` 出包（选 `tar.gz` 时任务卡片会提示「Worker 未回带格式确认」）。私有路径不经过 Worker 触发，`tar.gz` 推完工作流即可用。

## 产物格式

每次运行都会先删掉旧的 `docker-images-batch` Release 再重建，所以同一个 Release 里只会存在一种格式的产物。

| 选择 | 单个镜像体积 | 产物名 | 导入方式 |
| --- | --- | --- | --- |
| `tar`（默认） | ≤ 900MB | `xxx.tar` | `docker load -i xxx.tar` |
| `tar.gz` | ≤ 900MB | `xxx.tar.gz` | `docker load -i xxx.tar.gz`（docker 直接支持 gz）或先 `gunzip` 再 load |
| 任意 | > 900MB | `xxx.part.aa`、`xxx.part.ab` … | 先合并再 load |

分片内容恒为**未压缩的 tar 切片**，和格式选择无关——`tar.gz` 只影响未超限的整包是否压缩。

### tar 文件

```shell
docker load -i xxx.tar
```

### gz 文件

```shell
docker load -i xxx.tar.gz
```

或

```shell
gunzip xxx.tar.gz
docker load -i xxx.tar
```

### part 分割文件

```shell
cat xxx.part.* > xxx.tar
docker load -i xxx.tar
```

## 在 GitHub Actions 界面手动触发

`Actions` → `Batch Pull and Package Docker Images` → `Run workflow`，参数如下：

| 参数 | 说明 |
| --- | --- |
| `images` | 镜像列表，每行一个，支持带仓库前缀的完整名称 |
| `format` | 打包格式：`tar`（默认）或 `tar.gz` |
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

## Worker 侧

`worker/worker.js` 做三件事：

1. 收到 `{ "key": "...", "validateOnly": true }` 时只校验授权码，不触发（私有路径会先调这个）
2. 校验授权码后，把 `images` 与 `format` 一起塞进 `workflow_dispatch` 的 `inputs`
3. 回带 `format` 字段，方便页面确认这次真的按所选格式转发

## 说明

- 登录只影响 `ghcr.io`，Docker Hub 等其他仓库的拉取行为不变。
- 工作流已声明 `packages: read` 权限，`GITHUB_TOKEN` 回退模式依赖该权限。
- 通过 `ghcr_token` 参数传入的 Token 会在日志中被 `::add-mask::` 打码，但仍会出现在本次运行的输入记录里，因此不要用于共享仓库。
- 选择 `tar.gz` 时体积更小；选 `tar` 时产物更大（大致相当于镜像解压后大小），GitHub Release 单文件上限 2GB，所以超限仍会走分片。
- 镜像列表会原样写进 Release 说明和 run 的 inputs，便于事后核对。
