export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      })
    }

    if (request.method !== 'POST') {
      return json({ success: false, message: 'Method Not Allowed' }, 405)
    }

    const API_KEY = env.DOCKER_API_KEY
    const GITHUB_TOKEN = env.GITHUB_TOKEN_SECRET

    if (!API_KEY) {
      return json({ success: false, message: 'Worker 未配置 DOCKER_API_KEY' }, 500)
    }
    if (!GITHUB_TOKEN) {
      return json({ success: false, message: 'Worker 未配置 GITHUB_TOKEN_SECRET' }, 500)
    }

    try {
      const body = await request.json()

      // 私有 Release 资产下载：用 token 换一次性签名地址。
      // 浏览器不能自己跟 302（release-assets.githubusercontent.com 没有 CORS 头），
      // 所以由 Worker 解析 Location 交给页面去导航，纯 token、不依赖浏览器登录。
      if (body && body.downloadAsset) {
        if (body.key !== API_KEY) {
          return json({ success: false, message: 'Unauthorized' }, 401)
        }
        return await resolveAssetLocation(body.downloadAsset, GITHUB_TOKEN)
      }

      const images = body.images
      const key = body.key || body.apiKey
      const format = normalizeFormat(body.format)
      const platform = normalizePlatform(body.platform)

      // 只校验授权码，不触发工作流（前端私有镜像路径会先调这个）
      if (body.validateOnly === true) {
        const ok = key && key === API_KEY
        return json({ success: ok, message: ok ? 'ok' : 'Unauthorized' }, ok ? 200 : 401)
      }

      if (!images || !Array.isArray(images) || images.length === 0) {
        return json({ success: false, message: 'images array required' }, 400)
      }

      if (!key || key !== API_KEY) {
        return json({ success: false, message: 'Unauthorized' }, 401)
      }

      const imagesString = images.join('\n')

      const ghRes = await fetch(`https://api.github.com/repos/${PUBLIC_OWNER}/${PUBLIC_REPO}/actions/workflows/${PUBLIC_WORKFLOW_FILE}/dispatches`, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'docker-batch-trigger-worker'
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            images: imagesString,
            format: format,
            platform: platform
          }
        })
      })

      if (ghRes.ok) {
        return json({
          success: true,
          message: `Batch workflow triggered for ${images.length} images (${format}, ${platform})`,
          format: format,
          platform: platform
        }, 200)
      }

      const text = await ghRes.text()
      return json({
        success: false,
        message: `GitHub API error: ${ghRes.status}`,
        details: text
      }, 200)
    } catch (err) {
      return json({ success: false, message: err.message }, 500)
    }
  }
}

const PUBLIC_OWNER = 'jianghuaangte'
const PUBLIC_REPO = 'download-docker-images'
const PUBLIC_WORKFLOW_FILE = 'batch-pull-docker.yml'

const PRIVATE_REPO = 'jianghuaangte/private-download-docker-images'

const ALLOWED_FORMATS = ['tar', 'tar.gz']
const DEFAULT_FORMAT = 'tar'

// 架构不做白名单：原样透传，工作流只在缺前缀时补 linux/（冷门架构也能用）
const DEFAULT_ARCH = 'amd64'
const ARCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,63}$/

// 只允许工作流声明过的取值，其余一律回退默认值，避免 dispatch 因未知 input 返回 422
function normalizeFormat(value) {
  if (typeof value !== 'string') return DEFAULT_FORMAT
  const v = value.trim().toLowerCase()
  return ALLOWED_FORMATS.includes(v) ? v : DEFAULT_FORMAT
}

function normalizePlatform(value) {
  if (typeof value !== 'string') return DEFAULT_ARCH
  const v = value.trim().toLowerCase()
  if (v === '' || v === 'auto') return DEFAULT_ARCH
  // 只做字符清洗（防注入/乱码），不判断架构是否存在
  return ARCH_PATTERN.test(v) ? v : DEFAULT_ARCH
}

// GET /repos/{owner}/{repo}/releases/assets/{id} + Accept: octet-stream
// 文档说明可能返回 200（直接给字节）或 302（给签名地址），这里两种都处理：
//   302 → 把 Location 交给调用方去导航
//   200 → 说明是流式返回，浏览器跨域读不了，返回提示让前端回退
async function resolveAssetLocation(asset, token) {
  const id = Number(asset && asset.id)
  if (!Number.isInteger(id) || id <= 0) {
    return json({ success: false, message: 'invalid asset id' }, 400)
  }
  const repo = asset.repo === 'private' ? PRIVATE_REPO : `${PUBLIC_OWNER}/${PUBLIC_REPO}`

  const res = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${id}`, {
    headers: {
      'Accept': 'application/octet-stream',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'docker-batch-download-worker'
    },
    redirect: 'manual'
  })

  const location = res.headers.get('Location')
  if (location && (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308)) {
    return json({ success: true, status: res.status, location: location }, 200)
  }

  const text = await res.text().catch(() => '')
  return json({
    success: false,
    status: res.status,
    message: res.status === 200
      ? '资产接口直接返回了内容（非 302），浏览器无法跨域读取，请用 Release 下载地址'
      : `GitHub asset API ${res.status}`,
    details: text.slice(0, 300)
  }, 200)
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }
  })
}
