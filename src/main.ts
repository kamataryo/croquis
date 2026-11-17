const NS = 'http://www.w3.org/2000/svg'
const COLORS: Record<string, string> = { red: '#e03131', blue: '#1971c2', green: '#2f9e44', black: '#000' }
const DASH: Record<string, string> = { solid: '', dashed: '10 7', dotted: '1 8' }

const hot = import.meta.hot!
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!
const stage = $('#stage')
const api = (p: string) => fetch('/api/' + p).then((r) => (r.ok ? r.json() : null))

let current: number | null = null
let drawing: SVGSVGElement // Claude のレイヤー
let sketch: SVGSVGElement // 赤ペンのレイヤー

// ---- 読み込みと表示 ----

// ファイルの SVG を DOM にする。script・foreignObject・イベント属性は落とす
function parseSvg(src: string | null): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(src ?? '', 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) return null
  svg.querySelectorAll('script, foreignObject').forEach((e) => e.remove())
  for (const el of [svg, ...svg.querySelectorAll('*')])
    for (const a of [...el.attributes])
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name)
  return document.importNode(svg, true) as unknown as SVGSVGElement
}

async function show(id: number | null | undefined) {
  const c = await api('croquis/' + id)
  if (!c) return
  const same = id === current
  const d = parseSvg(c.drawing)
  if (!d && same) return // 書きかけで壊れている間は、前の表示のままにする
  drawing = d ?? document.createElementNS(NS, 'svg')
  if (!drawing.viewBox.baseVal.width)
    drawing.setAttribute('viewBox', `0 0 ${parseFloat(drawing.getAttribute('width')!) || 800} ${parseFloat(drawing.getAttribute('height')!) || 600}`)
  drawing.removeAttribute('width')
  drawing.removeAttribute('height')

  // 赤ペンは図と同じ viewBox で重ねる。同じクロッキーの更新なら、描きかけを残す
  const kept = same && sketch ? [...sketch.children] : [...(parseSvg(c.sketch)?.children ?? [])]
  sketch = document.createElementNS(NS, 'svg')
  sketch.setAttribute('viewBox', drawing.getAttribute('viewBox')!)
  sketch.append(...kept)
  stage.replaceChildren(drawing, sketch)

  current = c.id
  history.replaceState(null, '', '#' + c.id)
  renderTabs()
}

async function renderTabs() {
  const list: { id: number; title?: string }[] = (await api('croquis')) ?? []
  $('#tabs').replaceChildren(
    ...list.map((c) => {
      const b = document.createElement('button')
      b.textContent = `${c.id}: ${c.title ?? ''}`
      b.setAttribute('aria-pressed', String(c.id === current))
      b.onclick = () => {
        hot.send('croquis:select', { id: c.id })
        show(c.id)
      }
      return b
    }),
  )
  return list
}

async function refresh() {
  const list = await renderTabs()
  const id = list.some((c) => c.id === current) ? current : list.at(-1)?.id
  if (id != null) return show(id)
  current = null
  stage.replaceChildren()
}

hot.on('croquis:changed', refresh)
hot.on('croquis:active', ({ id }) => show(id))

// ---- 赤ペン ----

const opt = () => Object.fromEntries(new FormData($<HTMLFormElement>('#tools'))) as Record<string, string>
const saveSketch = () =>
  hot.send('croquis:sketch', { id: current, svg: new XMLSerializer().serializeToString(sketch) })

// 画面上の位置 → 図の座標
const pos = (e: PointerEvent) => {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(sketch.getScreenCTM()!.inverse())
  return [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]
}
// 中点を通る 2 次ベジェでつなぐだけの平滑化。筆圧や線の入り抜きが欲しくなったら perfect-freehand に替える
const smooth = (p: number[][]) => {
  let d = `M${p[0]}`
  for (let i = 1; i < p.length - 1; i++) d += `Q${p[i]} ${(p[i][0] + p[i + 1][0]) / 2},${(p[i][1] + p[i + 1][1]) / 2}`
  return d + `L${p.at(-1)}`
}

let el: SVGElement | null = null
let pts: number[][] = []

stage.onpointerdown = (e) => {
  if (current == null || e.button) return
  stage.setPointerCapture(e.pointerId)
  const o = opt()
  el = document.createElementNS(NS, o.tool === 'ellipse' ? 'ellipse' : 'path')
  const attrs: Record<string, string> = {
    fill: 'none', stroke: COLORS[o.color], 'stroke-width': o.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke', // 太さは図の縮尺によらず画面上の px
    'stroke-dasharray': DASH[o.dash], 'data-color': o.color, 'data-dash': o.dash,
  }
  for (const [k, v] of Object.entries(attrs)) if (v) el.setAttribute(k, v)
  pts = [pos(e)]
}
stage.onpointermove = (e) => {
  if (!el) return
  const p = pos(e)
  if (el.tagName === 'ellipse') {
    const [a] = pts
    const v = { cx: (a[0] + p[0]) / 2, cy: (a[1] + p[1]) / 2, rx: Math.abs(p[0] - a[0]) / 2, ry: Math.abs(p[1] - a[1]) / 2 }
    for (const [k, n] of Object.entries(v)) el.setAttribute(k, String(n))
  } else {
    pts.push(p)
    el.setAttribute('d', smooth(pts))
  }
  if (!el.parentNode) sketch.append(el) // 動かさないクリックでは何も残さない
}
stage.onpointerup = stage.onpointercancel = () => {
  if (el?.parentNode) saveSketch()
  el = null
}

$('#undo').onclick = () => {
  if (current == null) return
  sketch.lastElementChild?.remove()
  saveSketch()
}
$('#clear-all').onclick = () => {
  if (current == null) return
  sketch.replaceChildren()
  saveSketch()
}

// ---- フィードバック ----

type Box = [number, number, number, number]

// 要素の bbox を図の座標系で求める（transform の付いたグループの中でも合うように、画面座標を経由する）
function box(el: SVGGraphicsElement): Box | null {
  try {
    const b = el.getBBox()
    const m = sketch.getScreenCTM()!.inverse().multiply(el.getScreenCTM()!)
    const c = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m))
    const x = Math.min(...c.map((p) => p.x)), y = Math.min(...c.map((p) => p.y))
    return [x, y, Math.max(...c.map((p) => p.x)) - x, Math.max(...c.map((p) => p.y)) - y]
  } catch {
    return null // 表示されていない要素
  }
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]))

function marks() {
  const cands = [...drawing.querySelectorAll<SVGGraphicsElement>('[id]')]
    .filter((e) => e instanceof SVGGraphicsElement && !e.closest('defs'))
    .map((e) => ({ id: e.id, b: box(e) }))
    .filter((c): c is { id: string; b: Box } => !!c.b)
    // 水平・垂直の線は面積が 0 になるので、1 の幅を持たせる
    .map((c) => ({ id: c.id, b: [c.b[0], c.b[1], Math.max(c.b[2], 1), Math.max(c.b[3], 1)] as Box }))
  return [...sketch.children].flatMap((m) => {
    const b = box(m as SVGGraphicsElement)
    if (!b) return []
    return [{
      type: m.tagName === 'ellipse' ? 'ellipse' : 'path',
      color: (m as SVGElement).dataset.color,
      dash: (m as SVGElement).dataset.dash,
      bbox: b.map(Math.round),
      // 要素の半分以上が印の bbox に入っていれば「囲まれた」とみなす。背景や大きなグループを拾わないため。
      // 長い矢印の端だけを囲んだ場合は拾えないので、そこは snapshot の画像で伝える
      targets: cands.filter((c) => overlap(c.b, b) >= 0.5 * c.b[2] * c.b[3]).map((c) => '#' + c.id),
    }]
  })
}

// 図と赤ペンを重ねた PNG（data URL）
async function snapshot() {
  const { width: w, height: h } = drawing.viewBox.baseVal
  const s = 1000 / Math.max(w, h)
  const W = Math.round(w * s), H = Math.round(h * s)
  const ser = (n: Node) => new XMLSerializer().serializeToString(n)
  const svg = `<svg xmlns="${NS}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${ser(drawing)}${ser(sketch)}</svg>`
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H })
  cv.getContext('2d')!.drawImage(img, 0, 0)
  return cv.toDataURL('image/png')
}

$<HTMLFormElement>('#fb').onsubmit = async (e) => {
  e.preventDefault()
  const comment = $<HTMLInputElement>('#comment')
  if (current == null || (!comment.value && !sketch.children.length)) return
  hot.send('croquis:feedback', { croquis: current, comment: comment.value, marks: marks(), png: await snapshot() })
  comment.value = ''
  if ($<HTMLInputElement>('#clear-after').checked) {
    sketch.replaceChildren()
    saveSketch()
  }
}
hot.on('croquis:saved', ({ id }) => ($('#msg').textContent = `送信しました (${id})`))

// ---- 状態の通知と初期表示 ----

const vis = () => hot.send('croquis:visibility', { visible: document.visibilityState === 'visible' })
document.addEventListener('visibilitychange', vis)
vis()

await show(Number(location.hash.slice(1)))
if (current == null) await show((await api('active'))?.id)
if (current == null) await refresh()
