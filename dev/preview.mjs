import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const port = Number(process.env.PROMPT_CRAFT_PREVIEW_PORT ?? 4178)
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    if (path === '/preview.js') {
      const bundle = await build({ entryPoints: [fileURLToPath(new URL('dev/preview.jsx', root))], bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } })
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      response.end(bundle.outputFiles[0].text)
    } else if (path === '/' || path === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(await readFile(new URL('dev/preview.html', root)))
    } else if (path === '/favicon.ico') { response.writeHead(204); response.end() }
    else { response.writeHead(404); response.end('Not found') }
  } catch (error) { response.writeHead(500); response.end(String(error)) }
})
server.listen(port, '127.0.0.1', () => console.log(`Prompt craft UI preview: http://127.0.0.1:${port}`))
