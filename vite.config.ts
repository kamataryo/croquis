import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const PORT = 5199
// タブを閉じてから消すまでの猶予。リロードや、閉じたタブを開き直す（Cmd+Shift+T）のを待つ。CROQUIS_GRACE_MS はテスト用
const GRACE = Number(process.env.CROQUIS_GRACE_MS ?? 60_000)
// 閉じた合図が来なかったもの（一度も開かなかった、ブラウザが落ちた）は、最後に触ってからこれだけたったら消す
const STALE = 24 * 60 * 60 * 1000

function croquis(): Plugin {
  return {
    name: 'croquis',
    configureServer(server) {
      // CROQUIS_DIR はテスト用（test.mjs が一時ディレクトリを渡す）
      const DIR = process.env.CROQUIS_DIR ?? path.join(server.config.root, '.croquis')
      fs.mkdirSync(DIR, { recursive: true })
      const dir = (id: unknown) => path.join(DIR, String(id))
      // id は数字だけを通す（パストラバーサル対策）
      const exists = (id: unknown) => /^\d+$/.test(String(id)) && fs.existsSync(dir(id))
      const read = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
      const readJson = (f: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return fallback } }
      const writeJson = (f: string, v: unknown) => fs.writeFileSync(f, JSON.stringify(v, null, 2))
      const ids = () => fs.readdirSync(DIR).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b)
      const hasFeedback = (id: unknown) => fs.readdirSync(dir(id)).includes('feedback') && fs.readdirSync(path.join(dir(id), 'feedback')).length > 0

      // ---- 後片付け ----
      // 1 クロッキー = ブラウザの 1 タブ。タブを閉じたら、そのクロッキーを消す
      const views = new Map<any, number>() // socket → そのタブが表示しているクロッキー
      const viewed = (id: number) => [...views.values()].includes(id)
      const closed = new Set<number>() // 閉じた合図が来て、まだ開き直されていないもの
      const remove = (id: number) => {
        fs.rmSync(dir(id), { recursive: true, force: true })
        closed.delete(id)
      }
      // 猶予のあと、開き直されておらず、未読のフィードバックもなければ消す。
      // 未読があるうちは Claude がこれから直すので残し、既読になったときにもう一度ここへ来る
      const reap = (id: number) =>
        setTimeout(() => {
          if (closed.has(id) && !viewed(id) && exists(id) && !hasFeedback(id)) remove(id)
        }, GRACE).unref()
      const sweep = () => {
        for (const id of ids()) {
          const files = [dir(id), ...fs.readdirSync(dir(id)).map((f) => path.join(dir(id), f))]
          if (!viewed(id) && Date.now() - Math.max(...files.map((f) => fs.statSync(f).mtimeMs)) > STALE) remove(id)
        }
      }
      // 起動の直後は、前から開いていたタブがまだつなぎ直していないので、少し待ってから
      setTimeout(sweep, 60_000).unref()
      setInterval(sweep, 60 * 60 * 1000).unref()

      let delivered = false // croquis wait にフィードバックを渡してから、既読になるまで（＝エージェントが処理している間）true
      let lastWait = 0 // croquis wait が最後に聞きに来た時刻。1 秒おきに来るので、途絶えたら待っていないとみなす

      // ---- ブラウザ → サーバー（Vite の ws custom event）----
      server.ws.on('croquis:view', ({ id }, client) => {
        if (!exists(id)) return
        const sock = (client as any).socket
        if (!views.has(sock)) sock.on('close', () => views.delete(sock))
        views.set(sock, Number(id))
        closed.delete(Number(id))
      })
      server.ws.on('croquis:sketch', ({ id, svg }) => {
        if (exists(id)) fs.writeFileSync(path.join(dir(id), 'sketch.svg'), String(svg))
      })
      server.ws.on('croquis:feedback', ({ items }, client) => {
        const d = new Date()
        const p = (n: number) => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
        // 1 通の分は同期で書ききる。途中で API が読むと、croquis wait が一部だけを受け取ってしまう
        const saved = (Array.isArray(items) ? items : []).filter((it) => exists(it?.croquis)).map(({ croquis: id, comment, marks, png }, i) => {
          const fbId = `fb-${stamp}-${p(i + 1)}`
          const fdir = path.join(dir(id), 'feedback')
          fs.mkdirSync(fdir, { recursive: true })
          fs.writeFileSync(path.join(fdir, `${fbId}.png`), Buffer.from(String(png).split(',')[1] ?? '', 'base64'))
          writeJson(path.join(fdir, `${fbId}.json`), {
            id: fbId, croquis: Number(id), comment: String(comment ?? ''), marks, snapshot: `feedback/${fbId}.png`,
          })
          return fbId
        })
        client.send('croquis:saved', { ids: saved })
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

          if (req.headers['x-croquis-wait']) lastWait = Date.now()

          const seg = new URL(req.url ?? '/', 'http://x').pathname.split('/').filter(Boolean)
          const m = req.method
          const body = async () => {
            req.setEncoding('utf8')
            let s = ''
            for await (const c of req) s += c
            return s ? JSON.parse(s) : {}
          }

          if (seg[0] === 'status' && m === 'GET') {
            const open = [...new Set(views.values())].sort((a, b) => a - b)
            return send(200, { open, waiting: !delivered && Date.now() - lastWait < 3000, processing: delivered })
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
                remove(Number(id))
                delivered = false
                return send(200, { id: Number(id) })
              }
            }

            if (seg.length === 3 && seg[2] === 'feedback') {
              const fdir = path.join(dir(id), 'feedback')
              if (m === 'GET') {
                const files = fs.existsSync(fdir) ? fs.readdirSync(fdir).filter((f) => f.endsWith('.json')).sort() : []
                if (files.length && req.headers['x-croquis-wait']) delivered = true
                return send(200, files.map((f) => {
                  const fb = readJson(path.join(fdir, f), {})
                  return { ...fb, snapshotPath: path.join(dir(id), fb.snapshot ?? '') }
                }))
              }
              if (m === 'DELETE') {
                // 既読 = 削除。履歴が要るようになったら feedback/read/ へ移す形に変える
                fs.rmSync(fdir, { recursive: true, force: true })
                delivered = false
                if (closed.has(Number(id))) reap(Number(id))
                return send(200, { id: Number(id) })
              }
            }

            // タブが閉じられた（ブラウザが pagehide で sendBeacon する）。リロードでも来るので、猶予を置いてから消す
            if (seg.length === 3 && seg[2] === 'close' && m === 'POST') {
              closed.add(Number(id))
              reap(Number(id))
              return send(200, { id: Number(id) })
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
