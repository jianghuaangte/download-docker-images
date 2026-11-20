## 下载地址
https://jianghuaangte.github.io/download-docker-images/

## 网页界面（推荐）

打开上面的下载地址，在页面里：

1. 「镜像名称」每行填一个镜像
2. 下载 `ghcr.io` 私有镜像时，在「GitHub Token」里填入个人访问令牌
3. 点击「批量触发下载任务」
4. 打包完成后在右侧任务卡片里「检测文件」并下载（支持 GitHub 加速地址、大文件自动分片）

### 两种触发方式

| 触发方式 | 需要填 | 说明 |
| --- | --- | --- |
| GitHub Token | 仅 Token，授权码可留空 | 浏览器直接调用 GitHub API 触发工作流，Token 同时用于登录 `ghcr.io`，可拉取私有镜像 |
| 授权码 | 仅授权码 | 走原有的加速服务，只能拉取公开镜像 |

### Token 需要的权限

| Token 类型 | 需要的权限 |
| --- | --- |
| 经典 PAT | `repo`、`workflow`、`read:packages` |
| 细粒度 PAT | Actions 读写、Contents 读、Packages 读 |

- `workflow` 权限是触发 `workflow_dispatch` 所必需的
- `read:packages` 用于登录 `ghcr.io` 拉取私有镜像
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
