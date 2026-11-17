import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const PORT = 5199

function croquis(): Plugin {
  return {
    name: 'croquis',
    configureServer(server) {
      // CROQUIS_DIR はテスト用（test.mjs が一時ディレクトリを渡す）
      const DIR = process.env.CROQUIS_DIR ?? path.join(server.config.root, '.croquis')
      fs.mkdirSync(DIR, { recursive: true })
      const stateFile = path.join(DIR, 'state.json')
      const dir = (id: unknown) => path.join(DIR, String(id))
      // id は数字だけを通す（パストラバーサル対策）
      const exists = (id: unknown) => /^\d+$/.test(String(id)) && fs.existsSync(dir(id))
      const read = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
      const readJson = (f: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fallback } }
      const writeJson = (f: string, v: unknown) => fs.writeFileSync(f, JSON.stringify(v, null, 2))
      const ids = () => fs.readdirSync(DIR).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b)
      const setActive = (id: number, changedBy: 'claude' | 'user') => {
        const state = { id, changedBy, at: new Date().toISOString() }
        writeJson(stateFile, state)
        return state
      }

      // ---- ブラウザ → サーバー（Vite の ws custom event）----
      const clients = new Map<any, boolean>() // socket → 表示中か
      server.ws.on('croquis:visibility', ({ visible }, client) => {
        const sock = (client as any).socket
        if (!clients.has(sock)) sock.on('close', () => clients.delete(sock))
        clients.set(sock, !!visible)
      })
      server.ws.on('croquis:select', ({ id }) => {
        if (exists(id)) setActive(Number(id), 'user')
      })
      server.ws.on('croquis:sketch', ({ id, svg }) => {
        if (exists(id)) fs.writeFileSync(path.join(dir(id), 'sketch.svg'), String(svg))
      })
      server.ws.on('croquis:feedback', ({ croquis: id, comment, marks, png }, client) => {
        if (!exists(id)) return
        const d = new Date()
        const p = (n: number) => String(n).padStart(2, '0')
        const fbId = `fb-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
        const fdir = path.join(dir(id), 'feedback')
        fs.mkdirSync(fdir, { recursive: true })
        fs.writeFileSync(path.join(fdir, `${fbId}.png`), Buffer.from(String(png).split(',')[1] ?? '', 'base64'))
        writeJson(path.join(fdir, `${fbId}.json`), {
          id: fbId, croquis: Number(id), comment: String(comment ?? ''), marks, snapshot: `feedback/${fbId}.png`,
        })
        client.send('croquis:saved', { id: fbId })
      })

      // ---- サーバー → ブラウザ ----
      // sketch.svg は対象外。描いている最中の赤ペンを巻き戻さないため
      server.watcher.on('all', (_ev, file) => {
        if (file.startsWith(DIR + path.sep) && /^(drawing\.svg|meta\.json)$/.test(path.basename(file)))
          server.ws.send('croquis:changed', {})
      })

      // ---- HTTP API（Claude 用）----
      server.middlewares.use('/api', async (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        try {
          // ほかのサイトのページからの呼び出し（CSRF）を断る。curl は Origin を付けない
          const origin = req.headers.origin
          if (origin && origin !== `http://${req.headers.host}`) return send(403, { error: 'forbidden origin' })

          const seg = new URL(req.url ?? '/', 'http://x').pathname.split('/').filter(Boolean)
          const m = req.method
          const body = async () => {
            req.setEncoding('utf8')
            let s = ''
            for await (const c of req) s += c
            return s ? JSON.parse(s) : {}
          }

          if (seg[0] === 'status' && m === 'GET') {
            const v = [...clients.values()]
            return send(200, { open: v.length > 0, visible: v.some(Boolean), clients: v.length })
          }

          if (seg[0] === 'active' && seg.length === 1) {
            if (m === 'GET') return send(200, readJson(stateFile, { id: null }))
            if (m === 'PUT') {
              const { id } = await body()
              if (!exists(id)) return send(404, { error: 'no such croquis' })
              const state = setActive(Number(id), 'claude')
              server.ws.send('croquis:active', { id: state.id })
              return send(200, state)
            }
          }

          if (seg[0] === 'croquis' && seg.length === 1) {
            if (m === 'GET')
              return send(200, ids().map((id) => ({ id, ...readJson(path.join(dir(id), 'meta.json'), {}) })))
            if (m === 'POST') {
              const { title } = await body()
              const id = (ids().at(-1) ?? 0) + 1
              fs.mkdirSync(dir(id))
              writeJson(path.join(dir(id), 'meta.json'), { title: title ?? `croquis ${id}`, createdAt: new Date().toISOString() })
              // drawing.svg はここでは作らない。Claude が Read なしで Write できるように
              return send(201, { id, drawingPath: path.join(dir(id), 'drawing.svg') })
            }
          }

          if (seg[0] === 'croquis' && seg.length >= 2) {
            const id = seg[1]
            if (!exists(id)) return send(404, { error: 'no such croquis' })
            const meta = path.join(dir(id), 'meta.json')
            const drawingPath = path.join(dir(id), 'drawing.svg')

            if (seg.length === 2) {
              if (m === 'GET')
                return send(200, {
                  id: Number(id), meta: readJson(meta, {}), drawingPath,
                  drawing: read(drawingPath), sketch: read(path.join(dir(id), 'sketch.svg')),
                })
              if (m === 'PUT') {
                const { title, drawing } = await body()
                if (drawing != null) fs.writeFileSync(drawingPath, String(drawing))
                if (title != null) writeJson(meta, { ...readJson(meta, {}), title })
                return send(200, { id: Number(id) })
              }
              if (m === 'DELETE') {
                fs.rmSync(dir(id), { recursive: true })
                if (readJson(stateFile, {}).id === Number(id)) fs.rmSync(stateFile)
                return send(200, { id: Number(id) })
              }
            }

            if (seg.length === 3 && seg[2] === 'feedback') {
              const fdir = path.join(dir(id), 'feedback')
              if (m === 'GET') {
                const files = fs.existsSync(fdir) ? fs.readdirSync(fdir).filter((f) => f.endsWith('.json')).sort() : []
                return send(200, files.map((f) => {
                  const fb = readJson(path.join(fdir, f), {})
                  return { ...fb, snapshotPath: path.join(dir(id), fb.snapshot ?? '') }
                }))
              }
              if (m === 'DELETE') {
                // 既読 = 削除。履歴が要るようになったら feedback/read/ へ移す形に変える
                fs.rmSync(fdir, { recursive: true, force: true })
                return send(200, { id: Number(id) })
              }
            }
          }

          send(404, { error: 'not found' })
        } catch (e) {
          send(e instanceof SyntaxError ? 400 : 500, { error: String(e) })
        }
      })
    },
  }
}

export default defineConfig({
  // localhost 専用。host と allowedHosts は緩めない
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
  plugins: [croquis()],
})
