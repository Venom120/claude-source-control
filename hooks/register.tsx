import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Block, Entry, LogRow, SC, Seg } from '../types'

const PANE = 'source-control'
const init: SC = {
  view: 'list', root: '', isRepo: true, branch: '', sync: '', entries: [], log: [], graphRows: 10, midScroll: 0, graphScroll: 0, confirm: '', collapsed: [],
  msg: '', msgRev: 0, simple: false, pathInput: '', note: '', file: '', diff: '', segs: [], editing: -1,
}
const sc = atom({ plugin: 'claude-source-control', key: 'sc' } as const, init)

const CONFLICT = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD'])
export const isConflict = (e: Entry) => CONFLICT.has(e.x + e.y)

export function parseStatus(out: string): { branch: string; sync: string; entries: Entry[] } {
  const lines = out.split('\n').filter(Boolean)
  const head = (lines.shift() ?? '').replace(/^## /, '')
  const m = head.match(/^(.*?)(?:\.\.\.\S+)?(?: \[(.*)\])?$/)
  const entries = lines.map(l => ({ x: l[0], y: l[1], path: l.slice(3).replace(/^"|"$/g, '') }))
  return { branch: m?.[1] ?? head, sync: m?.[2] ?? '', entries }
}

const RS = String.fromCharCode(30) // record separator
const US = String.fromCharCode(31) // field separator

// records split by RS, fields by US; a trailing --shortstat line follows the body
export function parseLog(out: string): LogRow[] {
  return out.split(RS).filter(r => r.trim()).map(rec => {
    const [hash, author, email, rel, date, refs, body, rest] = rec.split(US)
    return { hash, subject: (body ?? '').split(String.fromCharCode(10))[0], refs: refs ?? '', author, email, rel, date, body: (body ?? '').trim(), stat: (rest ?? '').trim() }
  })
}

// plain-text version of VS Code's history-item hover: author/date, message, refs, stats, hash
export function commitTip(r: LogRow): string {
  const refs = r.refs.split(', ').filter(Boolean).map(x => x.replace('HEAD -> ', '')).join(', ')
  return [`${r.author} <${r.email}>, ${r.rel} (${r.date})`, r.body, refs, r.stat, r.hash].filter(Boolean).join(String.fromCharCode(10, 10))
}

export function parseConflicts(text: string): Seg[] {
  const segs: Seg[] = []
  let buf: string[] = []
  let cur: Block | null = null
  let side: 'ours' | 'theirs' | 'base' = 'ours'
  for (const line of text.split('\n')) {
    if (line.startsWith('<<<<<<< ')) {
      segs.push(buf.join('\n'))
      buf = []
      cur = { ours: [], theirs: [], pick: null }
      side = 'ours'
    } else if (cur && line.startsWith('||||||| ')) side = 'base'
    else if (cur && line === '=======') side = 'theirs'
    else if (cur && line.startsWith('>>>>>>> ')) {
      segs.push(cur)
      cur = null
    } else if (cur) {
      if (side !== 'base') cur[side].push(line)
    } else buf.push(line)
  }
  segs.push(buf.join('\n'))
  return segs
}

export const joinSegs = (segs: Seg[]): string =>
  segs.map(s => (typeof s === 'string' ? s : (s.pick ?? ''))).join('\n')
export const allResolved = (segs: Seg[]) => segs.every(s => typeof s === 'string' || s.pick !== null)

// keep only hunks: the Code element's diff format reads past ---/+++ but not git's headers
export const hunksOnly = (diff: string) => {
  const i = diff.indexOf('@@')
  return i < 0 ? '' : diff.slice(i)
}

// 16x16 stroke icons in the editor's grey
const icon = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#c5c5c5" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICON = {
  down: icon('<path d="M3.5 6l4.5 4.5L12.5 6"/>'),
  right: icon('<path d="M6 3.5l4.5 4.5L6 12.5"/>'),
  file: icon('<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>'),
  refresh: icon('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.5v3h-3"/>'),
  branch: icon('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="6" r="1.5"/><path d="M4.5 5v6M11.5 7.5c0 3-7 1.5-7 4"/>'),
}
const dot = (line: boolean, tip: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="22" viewBox="0 0 11 22"><title>${titleText(tip)}</title>${line ? '<path d="M5.5 0v22" stroke="#3794FF" stroke-width="1"/>' : ''}<circle cx="5.5" cy="11" r="4" fill="#3794FF" stroke="#181818" stroke-width="2"/></svg>`


const NL = String.fromCharCode(10)
const titleText = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split(NL).join('&#10;')
const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Values from microsoft/vscode scm.css + scmHistory.ts: label = 18px high, radius 10, 12px text,
// 3px-padded 12px branch icon, description capped at 100px, 4px gaps; colours chartsBlue/chartsPurple/#EA5C00.
const BRANCH_ICON = '<path d="M4.5 3v7M4.5 10c0-3 5-1.5 5-5" stroke="#181818" stroke-width="1.1" fill="none"/><circle cx="4.5" cy="2.5" r="1.3" fill="#181818"/><circle cx="4.5" cy="10.5" r="1.3" fill="#181818"/><circle cx="9.5" cy="4.5" r="1.3" fill="#181818"/>'
export function refPills(refs: string, tip?: string, max = 1): { src: string; w: number } | null {
  const raw = refs.split(', ').filter(Boolean)
  const headName = raw.find(r => r.startsWith('HEAD -> '))?.slice(8)
  const all = raw.map(r => r.replace('HEAD -> ', ''))
  if (!all.length) return null
  const shown = all.slice(0, max)
  const extra = all.length - shown.length
  let x = 0
  let body = ''
  const pill = (label: string, fill: string, icon: boolean) => {
    const text = label.length > 15 ? label.slice(0, 14) + '…' : label
    const tw = Math.min(100, Math.round(text.length * 6.6))
    const lead = icon ? 18 : 4 // 3px pad + 12px icon + 3px pad
    const w = lead + tw + 4
    body += `<rect x="${x}" y="2" width="${w}" height="18" rx="10" fill="${fill}"/>`
    if (icon) body += `<svg x="${x + 3}" y="5" width="12" height="12" viewBox="0 0 14 14">${BRANCH_ICON}</svg>`
    body += `<text x="${x + lead}" y="15.5" fill="#181818" font-size="12" font-family="system-ui,sans-serif">${esc(text)}</text>`
    x += w + 4
  }
  for (const r of shown) {
    if (r.startsWith('tag: ')) pill(r.slice(5), '#d7ba7d', false)
    else if (r.includes('/')) pill(r, headName && r === `origin/${headName}` ? '#EA5C00' : '#B180D7', true)
    else pill(r, '#3794FF', true)
  }
  if (extra > 0) pill(`+${extra}`, '#4D4D4D', false)
  const src = `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="22" viewBox="0 0 ${x} 22"><title>${tip ? titleText(tip) : all.map(esc).join('&#10;')}</title>${body}</svg>`
  return { src, w: x }
}

// count badge: badge.background #4D4D4D, 18px high, fully rounded (scm.css .monaco-count-badge)
export const badge = (n: number) => {
  const w = Math.max(18, String(n).length * 7 + 11)
  return {
    w,
    src: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="18" viewBox="0 0 ${w} 18"><rect width="${w}" height="18" rx="9" fill="#4D4D4D"/><text x="${w / 2}" y="13" text-anchor="middle" fill="#fff" font-size="11" font-family="system-ui,sans-serif">${n}</text></svg>`,
  }
}


// commit subject drawn as an image so the hover title covers the text (Svg is the only element with hover tooltips)
export const subjectSvg = (subject: string, isHead: boolean, tip: string) => {
  const w = Math.round(subject.length * 7.4) + 8
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="22" viewBox="0 0 ${w} 22"><title>${titleText(tip)}</title><rect width="${w}" height="22" fill="transparent"/><text x="2" y="15.5" fill="#cccccc" font-size="13" font-weight="${isHead ? 600 : 400}" font-family="system-ui,sans-serif">${esc(subject)}</text></svg>`
}

const STATUS: Record<string, string> = { M: '#e2c08d', A: '#73c991', '?': '#73c991', D: '#c74e39', R: '#73c991', U: '#c74e39' }

async function git($: any, args: string[]) {
  const { root } = await read($, sc)
  return $.process.run(['git', ...args], root ? { cwd: root } : undefined)
}

async function refresh($: any) {
  const r = await git($, ['status', '--porcelain=v1', '-b'])
  if (r.exitCode !== 0) return update($, sc, s => ({ ...s, isRepo: false, entries: [], log: [], note: '' }))
  const st = parseStatus(r.stdout)
  const l = await git($, ['log', '-n', '60', '--shortstat', '--date=format:%a %b %d %Y %H:%M', '--pretty=format:%x1e%h%x1f%an%x1f%ae%x1f%ar%x1f%ad%x1f%D%x1f%B%x1f'])
  return update($, sc, s => ({ ...s, ...st, isRepo: true, log: l.exitCode === 0 ? parseLog(l.stdout) : [] }))
}

// run git, show its result as the note, refresh
async function act($: any, note: string, args: string[]) {
  const r = await git($, args)
  const out = (r.exitCode === 0 ? note : r.stderr || r.stdout).trim().slice(0, 300)
  await update($, sc, s => ({ ...s, note: out }))
  await refresh($)
  return r
}

async function openDiff($: any, e: Entry, staged: boolean) {
  const args = e.x === '?' ? ['diff', '--no-index', '--', '/dev/null', e.path] : staged ? ['diff', '--cached', '--', e.path] : ['diff', '--', e.path]
  const r = await git($, args)
  const diff = hunksOnly(r.stdout.split('\n').slice(0, 600).join('\n'))
  await update($, sc, s => ({ ...s, view: 'diff', file: e.path, diff }))
}

async function openCommit($: any, r: LogRow) {
  const s = await git($, ['show', '--stat', '--format=', r.hash])
  await update($, sc, x => ({ ...x, view: 'commit', file: r.subject, diff: commitTip(r) + String.fromCharCode(10, 10) + s.stdout.trim() }))
}

// VS Code's "Discard Changes": tracked files are restored, untracked files deleted; asks twice because it can't be undone
async function discard($: any, en: Entry) {
  const s = await read($, sc)
  if (s.confirm !== en.path) return update($, sc, x => ({ ...x, confirm: en.path, note: `Click again to discard ${en.path} (cannot be undone)` }))
  await update($, sc, x => ({ ...x, confirm: '' }))
  return act($, `Discarded ${en.path}`, en.y === '?' ? ['clean', '-f', '--', en.path] : ['restore', '--', en.path])
}

async function discardAll($: any) {
  const s = await read($, sc)
  if (s.confirm !== '*') return update($, sc, x => ({ ...x, confirm: '*', note: 'Choose Discard All Changes again to discard everything unstaged (cannot be undone)' }))
  await update($, sc, x => ({ ...x, confirm: '' }))
  await git($, ['restore', '--', '.'])
  return act($, 'Discarded all changes', ['clean', '-f'])
}

async function openConflict($: any, path: string) {
  const { root } = await read($, sc)
  const base = root || (await $.session.cwd())
  const text = await $.fs.read(`${base}/${path}`)
  await update($, sc, s => ({ ...s, view: 'conflict', file: path, segs: parseConflicts(text), editing: -1 }))
}

function setBlock($: any, i: number, fn: (b: Block) => string) {
  return update($, sc, s => ({
    ...s,
    editing: -1,
    segs: s.segs.map((g, j) => (j === i && typeof g !== 'string' ? { ...g, pick: fn(g) } : g)),
  }))
}

async function commit($: any, push: boolean, amend: boolean) {
  const s = await read($, sc)
  if (amend) return act($, 'Amended', s.msg.trim() ? ['commit', '--amend', '-m', s.msg] : ['commit', '--amend', '--no-edit'])
  if (!s.msg.trim()) return update($, sc, x => ({ ...x, note: 'Enter a commit message first' }))
  // VS Code (smart commit off): never stage on the user's behalf
  if (!s.entries.some(e => e.x !== ' ' && e.x !== '?' && !isConflict(e))) return update($, sc, x => ({ ...x, note: 'There are no staged changes to commit. Stage changes with + first.' }))
  const r = await act($, 'Committed', ['commit', '-m', s.msg])
  if (r.exitCode !== 0) return
  await update($, sc, x => ({ ...x, msg: '', msgRev: x.msgRev + 1 }))
  if (push) await act($, 'Committed and pushed', ['push'])
}

async function generate($: any) {
  await update($, sc, s => ({ ...s, note: 'Generating commit message…' }))
  const d = await git($, ['diff', '--cached'])
  const diff = d.stdout || (await git($, ['diff'])).stdout
  const r = await $.model.complete({
    model: 'claude-haiku-5-5',
    prompt: `Write a one-line conventional commit message for this diff. Reply with the message only.\n\n${diff.slice(0, 20000)}`,
  })
  await update($, sc, s => ({ ...s, msg: r.isAnswered ? r.text.trim() : s.msg, msgRev: s.msgRev + 1, note: r.isAnswered ? '' : 'Could not generate' }))
}

async function menu($: any, v: string) {
  if (v === 'commit') return commit($, false, false)
  if (v === 'amend') return commit($, false, true)
  if (v === 'push') return commit($, true, false)
  if (v === 'sync') {
    await commit($, false, false)
    await act($, 'Pulled', ['pull'])
    return act($, 'Synced', ['push'])
  }
  if (v === 'pushonly') return act($, 'Pushed', ['push'])
  if (v === 'pull') return act($, 'Pulled', ['pull'])
  if (v === 'fetch') return act($, 'Fetched', ['fetch', '--all'])
  if (v === 'undo') return act($, 'Last commit undone (changes kept staged)', ['reset', '--soft', 'HEAD~1'])
  if (v === 'discardall') return discardAll($)
  if (v === 'stageall') return act($, 'Staged all', ['add', '-A'])
  if (v === 'unstageall') return act($, 'Unstaged all', ['reset'])
}

async function openRepo($: any, path: string) {
  await $.store.set('root', path)
  await update($, sc, s => ({ ...s, root: path }))
  await refresh($)
}


const ROW = 2 // every list row is drawn 2 cells high, so a window of N rows can be counted exactly
const MORE = [
  { value: 'commit', label: 'Commit' }, { value: 'amend', label: 'Commit (Amend)' },
  { value: 'push', label: 'Commit & Push' }, { value: 'sync', label: 'Commit & Sync' },
  { value: 'pushonly', label: 'Push' }, { value: 'pull', label: 'Pull' }, { value: 'fetch', label: 'Fetch' },
  { value: 'undo', label: 'Undo Last Commit' }, { value: 'stageall', label: 'Stage All Changes' },
  { value: 'discardall', label: 'Discard All Changes' }, { value: 'unstageall', label: 'Unstage All Changes' },
]

// lines the message box needs (soft-wrapped at ~42 columns)
export const msgLinesOf = (msg: string) => msg.split(String.fromCharCode(10)).reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 42)), 0)

export type Layout = { top: number; mid: number; midItems: number; graph: number; graphItems: number }
export function layout(bodyRows: number, msgLines: number, simple: boolean, hasNote: boolean, graphOpen: boolean, graphRows: number): Layout {
  const msg = simple ? 3 : Math.min(msgLines, 8) + 2 + (msgLines > 8 ? 1 : 0)
  const top = ROW + msg + ROW + (hasNote ? 1 : 0) + 1
  const graph = graphOpen ? graphRows + ROW + 2 : ROW + 2
  const mid = Math.max(ROW * 2, bodyRows - top - graph)
  return { top, mid, midItems: Math.floor(mid / ROW), graph, graphItems: Math.floor(graphRows / ROW) }
}

type Item = { h?: { k: string; title: string; count?: number }; en?: Entry; kind?: 'c' | 's' | 'u' }
export function flatten(s: SC): Item[] {
  const conflicts = s.entries.filter(isConflict)
  const staged = s.entries.filter(x => x.x !== ' ' && x.x !== '?' && !isConflict(x))
  const changes = s.entries.filter(x => x.y !== ' ' && !isConflict(x))
  const out: Item[] = []
  const group = (k: string, title: string, list: Entry[], kind: 'c' | 's' | 'u', always: boolean) => {
    if (!list.length && !always) return
    out.push({ h: { k, title, count: list.length } })
    if (!s.collapsed.includes(k)) list.forEach(en => out.push({ en, kind }))
  }
  group('conf', 'Merge Conflicts', conflicts, 'c', false)
  group('staged', 'Staged Changes', staged, 's', false)
  group('changes', 'Changes', changes, 'u', true)
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'source-control', description: 'Open the Source Control pane' })
    const saved = await $.store.get('root')
    if (typeof saved === 'string') await update($, sc, s => ({ ...s, root: saved }))
    const simple = await $.store.get('simpleInput')
    if (simple === true) await update($, sc, s => ({ ...s, simple: true }))
    await $.command.register({ name: 'source-control-simple', description: 'Toggle the plain single-line commit box (fallback)' })
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'source-control-simple' }, async $ => {
    const s = await read($, sc)
    await $.store.set('simpleInput', !s.simple)
    await update($, sc, x => ({ ...x, simple: !x.simple }))
    return { text: s.simple ? 'Multi-line commit box on.' : 'Plain single-line commit box on.' }
  })

  // keystrokes from the multi-line box (hooks/msgbox.tsx)
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'msgbox') return next(e)
    const d = e.data as { text?: string; commit?: boolean }
    if (typeof d.text === 'string') await update($, sc, x => ({ ...x, msg: d.text as string }))
    if (d.commit) await commit($, false, false)
    return next(e)
  })

  on('command.run', { command: 'source-control' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Source Control' })
    await refresh($)
    return { text: 'Source Control opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($) // Claude may have edited files
    return next(e)
  })

  // wheel over the changes list or the graph moves that list's own window; elsewhere the engine's scroll stands
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const ptr = e.pointer
    if (!ptr || e.origin.kind !== 'person') return next(e)
    const s = await read($, sc)
    if (s.view !== 'list' || !s.isRepo) return next(e)
    const open = !s.collapsed.includes('graph')
    const L = layout(e.bodyRows, msgLinesOf(s.msg), s.simple, !!s.note, open, s.graphRows)
    const step = e.by < 0 ? -1 : 1
    if (ptr.row >= L.top && ptr.row < L.top + L.mid) {
      const max = Math.max(0, flatten(s).length - L.midItems)
      await update($, sc, x => ({ ...x, midScroll: Math.min(max, Math.max(0, x.midScroll + step)) }))
      return {}
    }
    if (open && ptr.row >= L.top + L.mid + ROW + 1) {
      const max = Math.max(0, s.log.length - L.graphItems)
      await update($, sc, x => ({ ...x, graphScroll: Math.min(max, Math.max(0, x.graphScroll + step)) }))
      return {}
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const s = await read($, sc)
    const label = s.isRepo ? `Source Control · ${s.branch || '…'} · ${s.entries.length}` : 'Source Control'
    return (
      <Box>
        <Button key="open-sc" label={label} onPress={() => $.ui.open({ id: PANE, title: 'Source Control', focus: true })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Select, Svg, Code, Client } = $.ui.resolve(e) as any
    const s = await read($, sc)
    const ic = (src: string, alt: string) => <Svg source={src} alt={alt} width={16} height={16} />
    const back = <Button key="back" label="← Back" onPress={() => update($, sc, x => ({ ...x, view: 'list' }))} />

    if (s.view === 'diff') {
      return (
        <Box flexDirection="column" gap={1} width="100%">
          <Box gap={2} alignItems="center">{back}<Text bold>{s.file}</Text></Box>
          {s.diff ? <Code source={s.diff} format="diff" path={s.file} /> : <Text dimColor>No textual changes (binary or empty file).</Text>}
        </Box>
      )
    }

    if (s.view === 'commit') {
      return (
        <Box flexDirection="column" gap={1} width="100%">
          <Box gap={2} alignItems="center">{back}<Text bold>{s.file}</Text></Box>
          <Text>{s.diff}</Text>
        </Box>
      )
    }

    if (s.view === 'conflict') {
      const done = allResolved(s.segs)
      return (
        <Box flexDirection="column" gap={1} width="100%">
          <Box gap={2} alignItems="center">{back}<Text bold>{s.file}</Text></Box>
          {s.segs.map((g, i) =>
            typeof g === 'string' ? (
              <Text dimColor>{g.split('\n').slice(-3).join('\n')}</Text>
            ) : (
              <Box flexDirection="column" borderStyle="round" borderColor={g.pick === null ? '#c74e39' : '#73c991'} padding={1}>
                <Box gap={1} flexWrap="wrap">
                  <Button key={`c${i}`} label="Accept Current" onPress={() => setBlock($, i, b => b.ours.join('\n'))} />
                  <Button key={`i${i}`} label="Accept Incoming" onPress={() => setBlock($, i, b => b.theirs.join('\n'))} />
                  <Button key={`b${i}`} label="Accept Both" onPress={() => setBlock($, i, b => [...b.ours, ...b.theirs].join('\n'))} />
                  <Button key={`e${i}`} label="Edit" onPress={() => update($, sc, x => ({ ...x, editing: i }))} />
                </Box>
                <Text backgroundColor="#1e3a2a">Current: {g.ours.join('\n') || '(empty)'}</Text>
                <Text backgroundColor="#1e2f4a">Incoming: {g.theirs.join('\n') || '(empty)'}</Text>
                {s.editing === i && (
                  <Input key={`in${i}`} label="Result (use \n for new lines)" value={(g.pick ?? g.ours.join('\n')).replace(/\n/g, '\\n')} submitLabel="Apply"
                    onSubmit={v => setBlock($, i, () => v.replace(/\\n/g, '\n'))} />
                )}
                {g.pick !== null && <Text dimColor>Resolved → {g.pick.slice(0, 80)}</Text>}
              </Box>
            ),
          )}
          <Button key="mark" variant="primary" label={done ? 'Mark resolved (git add)' : 'Resolve every conflict first'}
            onPress={async () => {
              if (!done) return
              const base = s.root || (await $.session.cwd())
              await $.fs.write(`${base}/${s.file}`, joinSegs(s.segs))
              await act($, `Resolved ${s.file}`, ['add', '--', s.file])
              await update($, sc, x => ({ ...x, view: 'list' }))
            }} />
        </Box>
      )
    }

    if (!s.isRepo) {
      return (
        <Box flexDirection="column" gap={1} width="100%">
          <Text bold>SOURCE CONTROL</Text>
          <Text>The folder currently open doesn't have a Git repository. Enter a repository path, or initialize one here.</Text>
          <Input key="path" label="Repository path" placeholder="C:\path\to\repo" value={s.pathInput} submitLabel="Open"
            onInput={v => update($, sc, x => ({ ...x, pathInput: v }))} onSubmit={v => openRepo($, v.trim())} />
          <Button key="init" variant="primary" label="Initialize Repository" onPress={() => act($, 'Initialized repository', ['init'])} />
          {s.note && <Text dimColor>{s.note}</Text>}
        </Box>
      )
    }

    const isOpen = (k: string) => !s.collapsed.includes(k)
    const toggle = (k: string) => update($, sc, x => ({ ...x, collapsed: x.collapsed.includes(k) ? x.collapsed.filter(c => c !== k) : [...x.collapsed, k] }))
    const bodyRows = (e.props as any)?.scroll?.bodyRows ?? 40
    const L = layout(bodyRows, msgLinesOf(s.msg), s.simple, !!s.note, isOpen('graph'), s.graphRows)
    const items = flatten(s)
    const ms = Math.min(s.midScroll, Math.max(0, items.length - L.midItems))
    const gs = Math.min(s.graphScroll, Math.max(0, s.log.length - L.graphItems))
    const resize = (d: number) => update($, sc, x => ({ ...x, graphRows: Math.min(30, Math.max(4, x.graphRows + d)) }))

    const header = (k: string, title: string, count?: number) => (
      <Box gap={1} alignItems="center" height={ROW} key={`h${k}`}>
        <Button key={`t${k}`} plain label={`${isOpen(k) ? '▾' : '▸'}  ${title}`} onPress={() => toggle(k)} />
        {count !== undefined && <Svg source={badge(count).src} alt={`${count}`} width={badge(count).w} height={18} />}
      </Box>
    )

    const row = (en: Entry, kind: 'c' | 's' | 'u') => {
      const code = kind === 'c' ? 'U' : kind === 's' ? en.x : en.y === '?' ? 'U' : en.y
      const slash = Math.max(en.path.lastIndexOf('/'), en.path.lastIndexOf(String.fromCharCode(92)))
      const name = en.path.slice(slash + 1)
      const dir = slash >= 0 ? en.path.slice(0, slash) : ''
      return (
        <Box gap={1} alignItems="center" height={ROW} paddingLeft={2} paddingRight={1} key={`r${kind}${en.path}`}>
          {ic(ICON.file, 'file')}
          <Button key={`${kind}${en.path}`} plain label={name} onPress={() => (kind === 'c' ? openConflict($, en.path) : openDiff($, en, kind === 's'))} />
          <Text dimColor wrap="truncate-start">{dir}</Text>
          <Box flexGrow={1} />
          {kind === 's' && <Button key={`un${en.path}`} label="−" onPress={() => act($, 'Unstaged', ['restore', '--staged', '--', en.path])} />}
          {kind === 'u' && <Button key={`ds${en.path}`} label={s.confirm === en.path ? 'Discard?' : '↩'} onPress={() => discard($, en)} />}
          {kind === 'u' && <Button key={`st${en.path}`} label="+" onPress={() => act($, 'Staged', ['add', '--', en.path])} />}
          <Text bold color={kind === 'c' ? '#c74e39' : (STATUS[code] ?? '#e2c08d')}>{code}</Text>
        </Box>
      )
    }

    // three fixed regions: top (header, message, buttons), middle (changes, wheel-scrolled), bottom (graph, wheel-scrolled)
    return (
      <Box flexDirection="column" width="100%" height={bodyRows}>
        <Box flexDirection="column" width="100%" flexShrink={0}>
          <Box alignItems="center" gap={1} height={ROW}>
            <Box flexGrow={1} />
            {ic(ICON.branch, 'branch')}
            <Button key="branch-toggle" plain label={s.branch} onPress={() => toggle('graph')} />
            {s.sync && <Text dimColor>{s.sync}</Text>}
            <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          </Box>
          {s.simple ? (
            <Input key="msg" placeholder={`Message (click Commit to commit on "${s.branch}")`} value={s.msg}
              onInput={v => update($, sc, x => ({ ...x, msg: v }))} onSubmit={() => {}} />
          ) : (
            <Client key="msgbox" module="./msgbox.tsx" width="100%"
              props={{ value: s.msg, rev: s.msgRev, placeholder: `Message (Ctrl+Enter to commit on "${s.branch}")`, maxRows: 8 }} />
          )}
          <Box gap={1} alignItems="center" width="100%" height={ROW}>
            <Button key="commit" variant="primary" label="✓ Commit" onPress={() => commit($, false, false)} />
            <Box flexGrow={1} />
            <Button key="gen" label="✨ Generate" onPress={() => generate($)} />
            <Select key="more" options={MORE} onSelect={v => menu($, v)} />
          </Box>
          {s.note && <Text dimColor>{s.note}</Text>}
        </Box>

        <Box flexDirection="column" width="100%" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
          {items.slice(ms, ms + L.midItems).map(it => (it.h ? header(it.h.k, it.h.title, it.h.count) : row(it.en as Entry, it.kind as 'c' | 's' | 'u')))}
          {s.entries.length === 0 && <Text dimColor>No changes.</Text>}
          {items.length > L.midItems && <Text dimColor>{`${ms + 1}-${Math.min(items.length, ms + L.midItems)} of ${items.length} · scroll with the wheel`}</Text>}
        </Box>

        <Box flexDirection="column" width="100%" flexShrink={0} borderStyle="single" borderColor="#3c3c3c">
          <Box gap={1} alignItems="center" height={ROW}>
            {header('graph', 'Graph')}
            <Box flexGrow={1} />
            {isOpen('graph') && <Button key="shrink" label="▼" onPress={() => resize(-2)} />}
            {isOpen('graph') && <Button key="grow" label="▲" onPress={() => resize(2)} />}
          </Box>
          {isOpen('graph') && (
            <Box flexDirection="column" height={s.graphRows} overflow="hidden">
              {s.log.slice(gs, gs + L.graphItems).map((r: LogRow, i: number) => {
                const tip = commitTip(r)
                const p = refPills(r.refs, tip)
                // ~8px per cell; room left after dot, padding, gaps, › button and the pills
                const room = Math.max(60, ((e.props as any)?.bodyColumns ?? 50) * 8 - 75 - (p ? p.w : 0))
                const max = Math.max(4, Math.floor(room / 7.4))
                const shown = r.subject.length > max ? r.subject.slice(0, max - 1) + '…' : r.subject
                return (
                  <Box gap={1} alignItems="center" height={ROW} paddingLeft={2} key={`g${r.hash}`} hover={{ backgroundColor: '#2a2d2e' }}>
                    <Svg source={dot(s.log.length > 1, tip)} alt={r.subject} width={11} height={22} isInteractive />
                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                      <Svg source={subjectSvg(shown, gs + i === 0, tip)} alt={r.subject} width={Math.round(shown.length * 7.4) + 8} height={22} isInteractive />
                    </Box>
                    <Button key={`c${r.hash}`} plain dimColor label="›" onPress={() => openCommit($, r)} />
                    {p && <Box flexShrink={0}><Svg source={p.src} alt={r.refs} width={p.w} height={22} isInteractive /></Box>}
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
