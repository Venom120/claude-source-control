import type { ClientModule } from 'claude-code'

// A multi-line text box drawn and edited entirely by key events (the stock Input is single-line).
// Enter / Shift+Enter = newline, Ctrl+Enter = commit, arrows/Home/End move, click places the caret.
// Grows up to maxRows lines, then scrolls. Text goes to the hooks module through surface.post.
type P = { value: string; rev: number; placeholder: string; maxRows: number }
type S = { text: string; cur: number; scroll: number; rev: number }

let latest: P = { value: '', rev: 0, placeholder: '', maxRows: 8 }
const NL = String.fromCharCode(10)

// visual lines as [start, end) offsets: hard breaks at newlines, soft wraps every `w` chars
function wrap(text: string, w: number): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  for (;;) {
    const nl = text.indexOf(NL, start)
    const lineEnd = nl < 0 ? text.length : nl
    let s = start
    do {
      const e = Math.min(lineEnd, s + w)
      out.push([s, e])
      s = e
    } while (s < lineEnd)
    if (nl < 0) break
    start = nl + 1
  }
  return out
}

// index of the visual line holding the caret (a soft-wrap boundary belongs to the next line)
function lineOf(vl: [number, number][], cur: number): number {
  let ci = 0
  for (let i = 0; i < vl.length; i++) if (vl[i][0] <= cur) ci = i
  return ci
}

function sync(st: S | undefined, p: P): S {
  if (!st || st.rev !== p.rev) return { text: p.value, cur: p.value.length, scroll: 0, rev: p.rev }
  return st
}

const SPECIAL = new Set(['up', 'down', 'left', 'right', 'return', 'tab', 'backspace', 'delete', 'pageup', 'pagedown', 'home', 'end', 'escape', 'insert', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'])

const MsgBox: ClientModule<P, S> = (props, surface) => {
  latest = props
  const { Box, Text } = surface.elements
  const w = Math.max(8, surface.columns - 4)
  const maxRows = Math.max(2, latest.maxRows)

  const fit = (text: string, cur: number, scroll: number) => {
    const vl = wrap(text, Math.max(8, surface.columns - 4))
    const ci = lineOf(vl, cur)
    const rows = Math.min(vl.length, maxRows)
    let sc = Math.min(scroll, Math.max(0, vl.length - rows))
    if (ci < sc) sc = ci
    if (ci > sc + rows - 1) sc = ci - rows + 1
    return sc
  }

  surface.onKey(k => {
    const s0 = sync(surface.state, latest)
    let { text, cur } = s0
    const key = k.key
    const vl = wrap(text, Math.max(8, surface.columns - 4))
    const ci = lineOf(vl, cur)
    if (key === 'return') {
      if (k.ctrl) {
        surface.post({ text, commit: true })
        return
      }
      text = text.slice(0, cur) + NL + text.slice(cur)
      cur += 1
    } else if (key === 'backspace') {
      if (cur > 0) {
        text = text.slice(0, cur - 1) + text.slice(cur)
        cur -= 1
      }
    } else if (key === 'delete') {
      text = text.slice(0, cur) + text.slice(cur + 1)
    } else if (key === 'left') cur = Math.max(0, cur - 1)
    else if (key === 'right') cur = Math.min(text.length, cur + 1)
    else if (key === 'home') cur = vl[ci][0]
    else if (key === 'end') cur = vl[ci][1]
    else if (key === 'up' || key === 'down') {
      const t = ci + (key === 'up' ? -1 : 1)
      if (t >= 0 && t < vl.length) cur = Math.min(vl[t][0] + (cur - vl[ci][0]), vl[t][1])
    } else if (key === 'tab' || SPECIAL.has(key) || k.ctrl || k.meta) return
    else {
      const ch = key === 'space' ? ' ' : key // a typed character, or pasted text
      text = text.slice(0, cur) + ch + text.slice(cur)
      cur += ch.length
    }
    surface.setState({ text, cur, rev: s0.rev, scroll: fit(text, cur, s0.scroll) })
    if (text !== s0.text) surface.post({ text })
  })

  surface.onPointer(e => {
    if (e.type !== 'down') return
    const s0 = sync(surface.state, latest)
    const vl = wrap(s0.text, w)
    const t = Math.min(vl.length - 1, Math.max(0, s0.scroll + e.y - 1))
    const cur = Math.min(vl[t][0] + Math.max(0, e.x - 2), vl[t][1])
    surface.setState({ ...s0, cur })
  })

  const st = sync(surface.state, props)
  const vl = wrap(st.text, w)
  const ci = lineOf(vl, st.cur)
  const rows = Math.min(vl.length, maxRows)
  const sc = Math.min(st.scroll, Math.max(0, vl.length - rows))
  const shown = vl.slice(sc, sc + rows)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#3c3c3c" paddingX={1} width="100%">
      {st.text === '' ? (
        <Text dimColor>{props.placeholder}</Text>
      ) : (
        shown.map(([a, b], i) => {
          const t = st.text.slice(a, b)
          if (sc + i !== ci) return <Text>{t || ' '}</Text>
          const col = st.cur - a
          return (
            <Box>
              <Text>{t.slice(0, col)}</Text>
              <Text inverse>{t[col] ?? ' '}</Text>
              <Text>{t.slice(col + 1)}</Text>
            </Box>
          )
        })
      )}
      {vl.length > rows && <Text dimColor>{`${sc + 1}-${sc + rows} of ${vl.length} lines`}</Text>}
    </Box>
  )
}

export default MsgBox
