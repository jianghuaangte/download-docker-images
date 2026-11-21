## 下载地址
https://jianghuaangte.github.io/download-docker-images/

## 网页界面（推荐）

打开上面的下载地址，在页面里：

1. 「镜像名称」每行填一个镜像（`#` 开头的行会被忽略）
2. 填写「授权码」（Cloudflare Worker 校验用）
3. 选择「打包格式」：`tar`（默认，原始包，下载后直接 `docker load`）或 `tar.gz`（压缩，体积最小）
4. 若要拉取 `ghcr.io` 私有镜像，再填入「GitHub Token」；页面会触发 **私有仓库** 的工作流，结果上传到私有 Release
5. 点击「批量触发下载任务」
6. 打包完成后在右侧任务卡片里「检测文件」并下载（公开镜像走加速地址，私有镜像由 Worker 换签名地址后下载；大文件自动分片）

格式选择会记在浏览器 localStorage，下次打开沿用上次的值；切换后已有任务卡片会重新检测文件。

### 两种触发方式

| 触发方式 | 授权码 | GitHub Token | 说明 |
| --- | --- | --- | --- |
| 私有镜像（推荐） | 必填 | 必填 | Worker 先校验授权码；通过后浏览器直连 GitHub API 触发 **私有仓库** 的工作流 |
| 公开镜像 | 必填 | 可留空 | 走加速 Worker，触发公开仓库工作流，结果上传公开 Release |

### 仓库说明

| 仓库 | 用途 | 访问方式 |
| --- | --- | --- |
| `jianghuaangte/download-docker-images` | 公开镜像，上传公开 Release | 可匿名/加速下载 |
| `jianghuaangte/private-download-docker-images` | 私有镜像，上传私有 Release | 下载资产必须带 Token（见下文） |

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

Worker 只放行 `tar` / `tar.gz`，其他值回退 `tar`，避免脏值让 GitHub 返回 `422`。

### 部署顺序

`workflow_dispatch` 不接受工作流未声明的 input，所以改格式相关的东西时要：

1. 先推 `.github/workflows/*.yml`
2. 再粘 `worker/worker.js` 到 Cloudflare Worker 编辑器保存部署

顺序反了会出现 `422 Unexpected inputs provided`。

### 如果 Worker 还是旧版本

旧 Worker 不转发 `format`，公开路径会按默认 `tar` 出包（选 `tar.gz` 时任务卡片会提示「Worker 未回带格式确认」）。私有路径不经过 Worker 触发，`tar.gz` 推完工作流即可用。

## 私有 Release 资产怎么下载

私有 Release 的资产**不能**用网页下载地址取。`github.com/OWNER/REPO/releases/download/TAG/FILE` 对私有仓库一律 404，带 `Authorization` 头也没用——那层认的是浏览器会话 cookie，302 落点的对象存储也不认这个头。

| 请求 | 结果 |
| --- | --- |
| `github.com/OWNER/REPO/releases/download/TAG/FILE`（私有仓库，匿名或带 Bearer） | 404 |
| 同路径（公开仓库） | 302 → 签名地址 |

正确方式是 API 资产端点 `GET /repos/{owner}/{repo}/releases/assets/{id}` + `Accept: application/octet-stream`：返回 **302** 指向一次性签名地址，也可能返回 200 直接给字节。

签名地址的时效，三个口径（2026-11-20 实测）：

| 口径 | 值 |
| --- | --- |
| SAS `se`（名义截止） | 窗口固定 60 分钟，但起点早于请求时刻，所以每次拿到的剩余 0–60 分钟（实测 36 分钟） |
| URL 里的 `jwt` | mint + 5 分钟 |
| 实际可用 | `t+0 / 330s / 900s / 1800s / 3600s` 全部 `206`，一小时后仍能取到 |

原因：`release-assets.githubusercontent.com` 是 CDN，响应会被边缘缓存，签名过期后仍可能命中缓存。所以**别把复制出来的链接当长期地址**（换 POP、缓存淘汰后就失效），页面每次点击都会重新换地址，正常使用不受影响。

浏览器跟着 302 会失败——签名地址不返回 `Access-Control-Allow-Origin`，`fetch` 拿不到响应体（页面表现为「下载失败」）。所以页面的私有下载走三步：

1. 页面把 `{ key, downloadAsset: { repo: 'private', id } }` POST 给 Worker
2. Worker 用 `GITHUB_TOKEN_SECRET` 调资产端点（`redirect: 'manual'`），把 302 的 `Location` 原样返回
3. 页面用隐藏 iframe 导航到签名地址，浏览器直接下载（导航不受 CORS 限制，也不会被弹窗拦截）

拿不到签名地址时回退到上面的 Release 下载地址，此时依赖浏览器已登录有权限的 GitHub 账号。

对应的 curl（纯 token，不需要浏览器）：

```bash
TOKEN="github_pat_xxx"
REPO="jianghuaangte/private-download-docker-images"
TAG="docker-images-batch"
NAME="ghcr.io_jianghuaangte_pdfflow_latest.tar"

ASSET_ID=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/releases/tags/$TAG" \
  | jq -r --arg n "$NAME" '.assets[] | select(.name==$n) | .id')

LOC=$(curl -s -o /dev/null -D - -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/octet-stream" \
  "https://api.github.com/repos/$REPO/releases/assets/$ASSET_ID" \
  | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')

curl -o "$NAME" "$LOC"
```

也可以直接用 `gh`：`GH_TOKEN=xxx gh release download docker-images-batch -R jianghuaangte/private-download-docker-images -p '*.tar'`

`GITHUB_TOKEN_SECRET` 要求能读私有仓库：经典 PAT 需要 `repo`，细粒度 PAT 需要该仓库的 `Contents: Read`。

## 产物格式

每次运行都会先删掉旧的 `docker-images-batch` Release 再重建，所以同一个 Release 里只会存在一种格式的产物。

| 选择 | 单个镜像体积 | 产物名 | 导入方式 |
| --- | --- | --- | --- |
| `tar`（默认） | ≤ 900MB | `xxx.tar` | `docker load -i xxx.tar` |
| `tar.gz` | ≤ 900MB | `xxx.tar.gz` | `docker load -i xxx.tar.gz`（docker 直接支持 gz）或先 `gunzip` 再 load |
| 任意 | > 900MB | `xxx.part.aa`、`xxx.part.ab` … | 先合并再 load |

分片内容恒为**未压缩的 tar 切片**，和格式选择无关——`tar.gz` 只影响未超限的整包是否压缩。

产物一律**按 tag 引用保存**：即使镜像名写成 `repo:tag@sha256:…`（digest 引用），工作流也会先 `docker tag` 把 tag 打到本地再 `docker save`，所以导入后一定有名字，不会变成 `<none>`。文件名同样不带 digest，例如 `ghcr.io_owner_repo_latest.tar`。

架构通过参数传给 `docker pull/save --platform <值>`，**完全原样**：不补前缀、不判断架构、不做别名映射。**留空就不传 `--platform`**，由 docker / skopeo 按运行器自身平台选择（多架构镜像通常取 `linux/amd64`，因为 runner 是 amd64）。

`--platform` 的语法是 `os/arch[/variant]`，`os` 不一定是 linux：

| 传入 | 实际 `--platform` |
| --- | --- |
| 空（或 `auto`） | 不带这个参数，交给 docker 默认 |
| `linux/arm64` | `linux/arm64` |
| `linux/riscv64` | `linux/riscv64` |
| `windows/amd64` | `windows/amd64` |
| `wasip1/wasm` | `wasip1/wasm` |
| `loong64`（裸值） | `loong64`（原样交出去，docker 认不认由它决定） |

界面上不提供架构选择框，两种指定方式：

| 方式 | 用法 |
| --- | --- |
| 页面 URL 参数 | `https://jianghuaangte.github.io/download-docker-images/?arch=linux/arm64` |
| 手动 Run workflow | `platform` 输入直接填 `linux/arm64` / `windows/amd64` / … |

skopeo 兜底时会把 `os/arch[/variant]` 拆成 `--override-os` / `--override-arch` / `--override-variant` 使用（例如 `windows/amd64` → `--override-os windows --override-arch amd64`）；没指定平台时不加任何 override，skopeo 用自己的默认平台。

> 注意：镜像只有 arm64 变体时，不指定平台会拉取失败（runner 是 amd64）。这种镜像要把 `platform` 写成 `linux/arm64`。

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

`worker/worker.js` 做三件事，需要两个 Secret：`DOCKER_API_KEY`（授权码）、`GITHUB_TOKEN_SECRET`（能触发公开仓库 Actions、能读私有仓库 Contents）。

| 请求体 | 行为 |
| --- | --- |
| `{ key, validateOnly: true }` | 只校验授权码，不触发（私有路径会先调这个） |
| `{ images, key, format }` | 校验授权码后把 `images`、`format` 放进 `workflow_dispatch` 的 `inputs`，响应里回带 `format` |
| `{ key, downloadAsset: { repo, id } }` | 用 token 调资产端点，返回 302 的 `Location`（一次性签名地址），供页面下载私有 Release 资产 |

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Actions 拉镜像报 `403 Forbidden`（ghcr.io） | 凭据读不到该包 | 配 `GHCR_TOKEN`（`read:packages`），或在包的 Settings → Manage Actions access 给本仓库 Read |
| 私有资产点下载提示「下载失败」 | Worker 还是旧版（没有 `downloadAsset`），页面退回 `fetch` 跟随 302 | 部署新版 `worker/worker.js` |
| 点私有下载打开 404 页面 | Worker 拿不到签名地址，且浏览器没登录有权限的账号 | 部署新版 Worker，并让 `GITHUB_TOKEN_SECRET` 具备 `Contents: Read` |
| 触发报 `422 Unexpected inputs provided` | 工作流没声明 `format`，Worker 却发了 | 先推工作流，再部署 Worker |

## 说明

- 登录只影响 `ghcr.io`，Docker Hub 等其他仓库的拉取行为不变。
- 工作流已声明 `packages: read` 权限，`GITHUB_TOKEN` 回退模式依赖该权限。
- 通过 `ghcr_token` 参数传入的 Token 会在日志中被 `::add-mask::` 打码，但仍会出现在本次运行的输入记录里，因此不要用于共享仓库。
- 选择 `tar.gz` 时体积更小；选 `tar` 时产物更大（大致相当于镜像解压后大小），GitHub Release 单文件上限 2GB，所以超限仍会走分片。
- 镜像列表会原样写进 Release 说明和 run 的 inputs，便于事后核对。
