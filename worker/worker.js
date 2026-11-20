addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const API_KEY = DOCKER_API_KEY
const GITHUB_TOKEN = GITHUB_TOKEN_SECRET
const PUBLIC_OWNER = 'jianghuaangte'
const PUBLIC_REPO = 'download-docker-images'
const PUBLIC_WORKFLOW_FILE = 'batch-pull-docker.yml'

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    })
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await request.json()
    const images = body.images
    const key = body.key || body.apiKey

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
        inputs: { images: imagesString }
      })
    })

    if (ghRes.ok) {
      return json({
        success: true,
        message: `Batch workflow triggered for ${images.length} images`
      }, 200)
    } else {
      const text = await ghRes.text()
      return json({
        success: false,
        message: `GitHub API error: ${ghRes.status}`,
        details: text
      }, 200)
    }
  } catch (err) {
    return json({ success: false, message: err.message }, 500)
  }
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
