const NS = 'http://www.w3.org/2000/svg'
// 赤ペンは原色。Claude の図はこの 4 色を使わない約束（skill/SKILL.md）なので、図と印を見分けられる
const COLORS: Record<string, string> = { red: '#ff0000', blue: '#0000ff', green: '#00ff00', yellow: '#ffff00' }
const WIDTHS = [2, 3, 5, 8, 12]
const NAMES: Record<string, string> = { red: '赤', blue: '青', green: '緑', yellow: '黄', solid: '実線', dashed: '破線', dotted: '点線', arrow: '矢印' }
const DEFAULTS = ['red', 'solid', '3']

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

// 1 タブ = 1 クロッキー。どれを表示するかは URL の # で決まり、タブの中では切り替えない
const ID = Number(location.hash.slice(1)) || null
let source: string | null = null // 表示している drawing.svg の中身
let title = 'croquis'
let unseen = false // タブが裏にある間に図が変わった
const retitle = () => (document.title = (unseen ? '● ' : '') + title)

async function show() {
  const c = ID == null ? null : await api('croquis/' + ID)
  if (!c) {
    // 消されたか、はじめから無い
    current = null
    const p = document.createElement('p')
    p.textContent = ID == null ? 'クロッキーがありません' : `クロッキー ${ID} はありません（削除されました）。このタブは閉じてください`
    stage.replaceChildren(p)
    title = 'croquis'
    retitle()
    return syncButtons()
  }
  const same = current != null
  const d = parseSvg(c.drawing)
  if (!d && same) return // 書きかけで壊れている間は、前の表示のままにする
  drawing = d ?? document.createElementNS(NS, 'svg')
  if (!drawing.viewBox.baseVal.width)
    drawing.setAttribute('viewBox', `0 0 ${parseFloat(drawing.getAttribute('width')!) || 800} ${parseFloat(drawing.getAttribute('height')!) || 600}`)
  drawing.removeAttribute('width')
  drawing.removeAttribute('height')

  // 赤ペンは図と同じ viewBox で重ねる。更新のときは、描きかけを残す
  const kept = same && sketch ? [...sketch.children] : [...(parseSvg(c.sketch)?.children ?? [])]
  sketch = document.createElementNS(NS, 'svg')
  sketch.setAttribute('viewBox', drawing.getAttribute('viewBox')!)
  sketch.append(...kept)
  stage.replaceChildren(drawing, sketch)

  // 裏にある間に図が変わったら、タブの名前に印を付ける（CLI からは、開いているタブを前に出せないので）
  if (same && c.drawing !== source && document.hidden) unseen = true
  source = c.drawing
  current = c.id
  title = `${c.id}: ${c.meta.title ?? ''}`
  retitle()
  syncButtons()
}

hot.on('croquis:changed', show)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  unseen = false
  retitle()
})

// ---- 色・線種・太さのドロップダウン ----

const opt = () => Object.fromEntries(new FormData($<HTMLFormElement>('#tools'))) as Record<string, string>

// 破線と点線の刻みは太さに比例させる。丸い線端が太さの分だけはみ出すので、固定の刻みだと太い線では隙間がつぶれる。
// 見た目の調整はここの係数で行う（破線：線 3w+4・隙間 w+4、点線：直径 w の点・隙間 w+2）
const dashArray = (dash: string, w: number) =>
  dash === 'dashed' ? `${2 * w + 4} ${2 * w + 4}` : dash === 'dotted' ? `0.01 ${2 * w + 2}` : ''
// 矢じり。マーカーではなくパスに書き足すので、色も太さも線と揃い、PNG にもそのまま出る
const headLen = (w: number) => 2 * w + 6
const head = (p: number[][], len: number) => {
  const [x, y] = p.at(-1)!
  // 手ぶれで向きが暴れないように、矢じりの長さだけ手前の点から向きを取る
  const [bx, by] = p.findLast(([px, py]) => Math.hypot(x - px, y - py) >= len) ?? p[0]
  const a = Math.atan2(y - by, x - bx)
  const r = (n: number) => Math.round(n * 100) / 100
  return [a - 0.45, a + 0.45].map((t) => `M${x},${y}L${r(x - len * Math.cos(t))},${r(y - len * Math.sin(t))}`).join('')
}
const line = (dash: string, w: number) => {
  const len = headLen(w)
  const h = Math.max(18, dash === 'arrow' ? Math.ceil(len * 0.87 + w + 2) : 0) // 矢じりの開きの分だけ行を高くする
  const d = `M10,${h / 2}H86` + (dash === 'arrow' ? head([[10, h / 2], [86, h / 2]], len) : '')
  return `<svg class="pv" width="96" height="${h}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dashArray(dash, w)}"/></svg>`
}
const VALUES: Record<string, string[]> = { color: Object.keys(COLORS), dash: ['solid', 'dashed', 'dotted', 'arrow'], width: WIDTHS.map(String) }
const preview = (name: string, v: string, o: Record<string, string>) =>
  name === 'color' ? `<span class="pv sw" style="background:${COLORS[v]}"></span>`
  : name === 'dash' ? line(v, +o.width)
  : `<span class="pv">${v}px${line(o.dash, +v)}</span>`

const pops = [...document.querySelectorAll<HTMLElement>('.pop')]
for (const pop of pops) {
  const name = pop.id.slice(2) // m-color → color
  pop.innerHTML = VALUES[name]
    .map((v) => {
      const n = NAMES[v] ?? `${v}px`
      return `<label title="${n}"><input type="radio" name="${name}" value="${v}" aria-label="${n}"${DEFAULTS.includes(v) ? ' checked' : ''} /><i class="pv"></i></label>`
    })
    .join('')
  // マウスで選んだら閉じる。矢印キーで選んでいる間（detail が 0）は開いたまま
  pop.onclick = (e) => e.detail && setTimeout(() => pop.hidePopover())
}
// 見本は、いまの太さと線種の組み合わせで描き直す。ボタンには選んでいるものの見本を出す
function syncMenus() {
  const o = opt()
  for (const pop of pops) {
    const name = pop.id.slice(2)
    for (const input of pop.querySelectorAll('input')) input.nextElementSibling!.outerHTML = preview(name, input.value, o)
    $(`[popovertarget=${pop.id}] .pv`).outerHTML = preview(name, o[name], o)
  }
}
$('#tools').onchange = syncMenus
syncMenus()

// ---- 赤ペン ----

const saveSketch = () => {
  hot.send('croquis:sketch', { id: current, svg: new XMLSerializer().serializeToString(sketch) })
  syncButtons()
}

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

// テキスト：押した位置に入力欄を重ね、確定（Enter か、ほかの場所を押す）で <text> にする。Esc で取り消す。
// 文字の大きさは 1 種類だけ（置いたときに画面上で TEXT_PX になる大きさ）
const TEXT_PX = 20
function typeText(e: PointerEvent, color: string) {
  const [x, y] = pos(e)
  const r = stage.getBoundingClientRect()
  const input = document.createElement('input')
  input.className = 'text-entry'
  input.ariaLabel = 'テキスト'
  input.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;color:${COLORS[color]};font-size:${TEXT_PX}px`
  // change は IME の変換中には起きないので、変換を確定する Enter では閉じない
  input.onchange = () => {
    const t = document.createElementNS(NS, 'text')
    const attrs = {
      x, y, fill: COLORS[color], 'font-size': Math.round((TEXT_PX / sketch.getScreenCTM()!.a) * 100) / 100,
      'font-family': 'sans-serif', 'font-weight': 'bold', 'dominant-baseline': 'central', 'data-color': color,
    }
    for (const [k, v] of Object.entries(attrs)) t.setAttribute(k, String(v))
    t.textContent = input.value
    sketch.append(t)
    saveSketch()
    input.blur()
  }
  input.onblur = () => input.remove()
  input.onkeydown = (ev) => {
    if (ev.key !== 'Escape' || ev.isComposing) return
    input.value = ''
    input.blur()
  }
  stage.append(input)
  input.focus()
}

stage.onpointerdown = (e) => {
  if (current == null || e.button || e.target instanceof HTMLInputElement) return
  const o = opt()
  if (o.tool === 'text') {
    e.preventDefault() // 既定の動作に任せると、出したばかりの入力欄からフォーカスが外れる
    return typeText(e, o.color)
  }
  stage.setPointerCapture(e.pointerId)
  el = document.createElementNS(NS, o.tool) // path | ellipse | rect
  const attrs: Record<string, string> = {
    fill: 'none', stroke: COLORS[o.color], 'stroke-width': o.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke', // 太さは図の縮尺によらず画面上の px
    'stroke-dasharray': dashArray(o.dash, +o.width), 'data-color': o.color, 'data-dash': o.dash,
  }
  for (const [k, v] of Object.entries(attrs)) if (v) el.setAttribute(k, v)
  pts = [pos(e)]
}
stage.onpointermove = (e) => {
  if (!el) return
  const p = pos(e)
  if (el.tagName !== 'path') {
    const [a] = pts
    const x = Math.min(a[0], p[0]), y = Math.min(a[1], p[1]), w = Math.abs(p[0] - a[0]), h = Math.abs(p[1] - a[1])
    const v = el.tagName === 'rect' ? { x, y, width: w, height: h } : { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }
    for (const [k, n] of Object.entries(v)) el.setAttribute(k, String(n))
  } else {
    pts.push(p)
    // 矢印はペンのときだけ（楕円と四角には向きがない）。矢じりの長さは画面上の px なので、図の単位に直す
    const arrow = el.dataset.dash === 'arrow' ? head(pts, headLen(+el.getAttribute('stroke-width')!) / sketch.getScreenCTM()!.a) : ''
    el.setAttribute('d', smooth(pts) + arrow)
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
// Cmd+Z / Ctrl+Z でも元に戻す。入力欄の中では、文字のアンドゥに任せる
addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z' || e.target instanceof HTMLInputElement) return
  e.preventDefault()
  $('#undo').click() // 無効のときは何も起きない
})
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
      type: m.tagName,
      ...(m.tagName === 'text' && { text: m.textContent }),
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

// 送信待ちのフィードバック。メモリの中だけなのでリロードで消える。残っている間は、ページを離れる前に確認を出す
let queue: { croquis: number; comment: string; marks: ReturnType<typeof marks>; png: string }[] = []
addEventListener('beforeunload', (e) => {
  if (queue.length) e.preventDefault()
})

function renderQueue() {
  $('#queue').replaceChildren(
    ...queue.map((f) => {
      const li = document.createElement('li')
      const text = document.createElement('span')
      text.textContent = text.title = f.comment || '（コメントなし）'
      const x = document.createElement('button')
      x.type = 'button'
      x.textContent = '×'
      x.ariaLabel = x.title = '送信待ちから外す'
      x.onclick = () => {
        queue = queue.filter((g) => g !== f)
        renderQueue()
      }
      li.append(Object.assign(new Image(), { src: f.png, alt: '' }), text, x)
      return li
    }),
  )
  $('#queue').dataset.n = String(queue.length)
  syncButtons()
}

// 押しても何も起きないボタンは無効にする
function syncButtons() {
  const marked = current != null && sketch.children.length > 0
  const draft = marked || (current != null && !!$<HTMLInputElement>('#comment').value)
  $<HTMLButtonElement>('#undo').disabled = $<HTMLButtonElement>('#clear-all').disabled = !marked
  $<HTMLButtonElement>('#enqueue').disabled = !draft
  $<HTMLButtonElement>('#send').disabled = !draft && !queue.length // 送信待ちがあれば、書きかけがなくても送れる
}
$('#comment').oninput = syncButtons

// Claude が croquis wait で待っているか、受け取って処理しているかを、2 秒おきにサーバーへ聞く
async function pollWait() {
  const s = await api('status').catch(() => null)
  const [state, text, title] = s?.processing ? ['processing', 'Claude 処理中', 'Claude がフィードバックを受け取って、対応しています']
    : s?.waiting ? ['waiting', 'Claude 待機中', '送るとすぐに Claude へ届きます']
    : ['idle', 'Claude は待っていません', '送ったあと、Claude に「フィードバックを見て」と伝えてください']
  Object.assign($('#wait'), { textContent: text, title }).dataset.state = state
}
setInterval(pollWait, 2000)
pollWait()

// いまのコメントと赤ペンを、送信待ちに加える
async function enqueue() {
  const comment = $<HTMLInputElement>('#comment')
  if (current == null || (!comment.value && !sketch.children.length)) return
  queue.push({ croquis: current, comment: comment.value, marks: marks(), png: await snapshot() })
  comment.value = ''
  if ($<HTMLInputElement>('#clear-after').checked) {
    sketch.replaceChildren()
    saveSketch()
  }
  renderQueue()
}
$('#enqueue').onclick = enqueue

$<HTMLFormElement>('#fb').onsubmit = async (e) => {
  e.preventDefault()
  await enqueue() // 書きかけがあれば、それも一緒に送る
  if (!queue.length) return
  // 1 通にまとめて送る。サーバーが一度に書ききるので、croquis wait が一部だけを読むことがない
  hot.send('croquis:feedback', { items: queue })
  queue = []
  renderQueue()
}
hot.on('croquis:saved', ({ ids }) => ($('#msg').textContent = `送信しました (${ids.length} 件)`))

// ---- 初期表示と後片付け ----

if (ID == null) {
  // # なしで開いたら、空のクロッキーを作って、そのタブにする（ユーザーが下絵を描いて送るとき）
  const { id } = await fetch('/api/croquis', { method: 'POST', body: '{}' }).then((r) => r.json())
  location.replace('#' + id)
  location.reload()
} else {
  await show()
  if (current != null) hot.send('croquis:view', { id: ID })
}
// # を書き換えたら、そのクロッキーのタブとして開き直す
addEventListener('hashchange', () => location.reload())
// タブを閉じたら、サーバーがこのクロッキーを消す。リロードでも送られるが、サーバーは猶予を置くので消えない。
// メモリ節約でタブが破棄されたときは pagehide が起きないので、消えない
addEventListener('pagehide', (e) => {
  if (current != null && !e.persisted) navigator.sendBeacon(`/api/croquis/${ID}/close`)
})
