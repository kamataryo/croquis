// API の一巡を確かめる。一時ディレクトリと別のポートを使うので、動いているビューアには触らない
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

process.env.CROQUIS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'croquis-'))
const server = await createServer({ server: { port: 5198 }, logLevel: 'silent' })
await server.listen()

const call = async (method, p, body, headers) => {
  const r = await fetch('http://127.0.0.1:5198/api/' + p, { method, headers, body: body && JSON.stringify(body) })
  return [r.status, await r.json()]
}

try {
  const [created, { id, drawingPath }] = await call('POST', 'croquis', { title: 'テスト' })
  assert.equal(created, 201)
  assert.equal(drawingPath, path.join(process.env.CROQUIS_DIR, String(id), 'drawing.svg'))

  fs.writeFileSync(drawingPath, '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const [, got] = await call('GET', `croquis/${id}`)
  assert.equal(got.meta.title, 'テスト')
  assert.match(got.drawing, /<svg/)

  await call('PUT', `croquis/${id}`, { title: '改題' })
  assert.deepEqual((await call('GET', 'croquis'))[1].map((c) => [c.id, c.title]), [[id, '改題']])

  assert.equal((await call('PUT', 'active', { id }))[1].changedBy, 'claude')
  assert.equal((await call('GET', 'active'))[1].id, id)
  assert.equal((await call('PUT', 'active', { id: 999 }))[0], 404)

  assert.deepEqual((await call('GET', 'status'))[1], { open: false, visible: false, clients: 0 })

  // フィードバックはブラウザが ws で書く。ここではファイルを置いて、読み出しと既読を確かめる
  const fdir = path.join(process.env.CROQUIS_DIR, String(id), 'feedback')
  fs.mkdirSync(fdir)
  fs.writeFileSync(path.join(fdir, 'fb-1.json'), JSON.stringify({ id: 'fb-1', snapshot: 'feedback/fb-1.png' }))
  const [, fbs] = await call('GET', `croquis/${id}/feedback`)
  assert.equal(fbs[0].snapshotPath, path.join(fdir, 'fb-1.png'))
  await call('DELETE', `croquis/${id}/feedback`)
  assert.deepEqual((await call('GET', `croquis/${id}/feedback`))[1], [])

  // 守り：ほかのサイトからの呼び出し、数字でない id、壊れた JSON
  assert.equal((await call('POST', 'croquis', {}, { Origin: 'https://evil.example' }))[0], 403)
  assert.equal((await call('GET', 'croquis/..%2F..'))[0], 404)
  const bad = await fetch('http://127.0.0.1:5198/api/croquis', { method: 'POST', body: '{' })
  assert.equal(bad.status, 400)

  await call('DELETE', `croquis/${id}`)
  assert.equal((await call('GET', `croquis/${id}`))[0], 404)
  assert.equal((await call('GET', 'active'))[1].id, null)
  console.log('ok')
} finally {
  await server.close()
  fs.rmSync(process.env.CROQUIS_DIR, { recursive: true })
}
