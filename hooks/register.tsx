import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Block, Entry, LogRow, SC, Seg } from '../types'

const PANE = 'source-control'
const init: SC = {
  view: 'list', root: '', isRepo: true, branch: '', sync: '', entries: [], log: [], collapsed: [],
  msg: '', pathInput: '', note: '', file: '', diff: '', segs: [], editing: -1,
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

export function parseLog(out: string): LogRow[] {
  return out.split('\n').filter(Boolean).map(l => {
    const [hash, subject, refs] = l.split('\t')
    return { hash, subject, refs: refs ?? '' }
  })
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
const dot = (line: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="22" viewBox="0 0 14 22">${line ? '<path d="M7 11v11M7 0v11" stroke="#3794ff" stroke-width="1.5"/>' : ''}<circle cx="7" cy="11" r="4" fill="#3794ff"/></svg>`

const STATUS: Record<string, string> = { M: '#e2c08d', A: '#73c991', '?': '#73c991', D: '#c74e39', R: '#73c991', U: '#c74e39' }

async function git($: any, args: string[]) {
  const { root } = await read($, sc)
  return $.process.run(['git', ...args], root ? { cwd: root } : undefined)
}

async function refresh($: any) {
  const r = await git($, ['status', '--porcelain=v1', '-b'])
  if (r.exitCode !== 0) return update($, sc, s => ({ ...s, isRepo: false, entries: [], log: [], note: '' }))
  const st = parseStatus(r.stdout)
  const l = await git($, ['log', '-n', '12', '--pretty=format:%h%x09%s%x09%D'])
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
  if (!s.entries.some(e => e.x !== ' ' && e.x !== '?' && !isConflict(e))) await git($, ['add', '-A'])
  const r = await act($, 'Committed', ['commit', '-m', s.msg])
  if (r.exitCode !== 0) return
  await update($, sc, x => ({ ...x, msg: '' }))
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
  await update($, sc, s => ({ ...s, msg: r.isAnswered ? r.text.trim() : s.msg, note: r.isAnswered ? '' : 'Could not generate' }))
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
  if (v === 'stageall') return act($, 'Staged all', ['add', '-A'])
  if (v === 'unstageall') return act($, 'Unstaged all', ['reset'])
}

async function openRepo($: any, path: string) {
  await $.store.set('root', path)
  await update($, sc, s => ({ ...s, root: path }))
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'source-control', description: 'Open the Source Control pane' })
    const saved = await $.store.get('root')
    if (typeof saved === 'string') await update($, sc, s => ({ ...s, root: saved }))
    void $.ui.open({ id: PANE, title: 'Source Control' })
    await refresh($)
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
    const { Box, Text, Button, Input, Select, Svg, Code } = $.ui.resolve(e) as any
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

    const conflicts = s.entries.filter(isConflict)
    const staged = s.entries.filter(x => x.x !== ' ' && x.x !== '?' && !isConflict(x))
    const changes = s.entries.filter(x => x.y !== ' ' && !isConflict(x))
    const isOpen = (k: string) => !s.collapsed.includes(k)
    const toggle = (k: string) => update($, sc, x => ({ ...x, collapsed: x.collapsed.includes(k) ? x.collapsed.filter(c => c !== k) : [...x.collapsed, k] }))

    const header = (k: string, title: string, count?: number, tint?: string) => (
      <Box gap={1} alignItems="center" key={`h${k}`}>
        {ic(isOpen(k) ? ICON.down : ICON.right, 'toggle')}
        <Button key={`t${k}`} plain label={title} onPress={() => toggle(k)} />
        {count !== undefined && <Text backgroundColor={tint ?? '#4d4d4d'} color="white"> {count} </Text>}
      </Box>
    )

    const row = (en: Entry, kind: 'c' | 's' | 'u') => {
      const code = kind === 'c' ? 'U' : kind === 's' ? en.x : en.y === '?' ? 'U' : en.y
      const slash = Math.max(en.path.lastIndexOf('/'), en.path.lastIndexOf('\\'))
      const name = en.path.slice(slash + 1)
      const dir = slash >= 0 ? en.path.slice(0, slash) : ''
      return (
        <Box gap={1} alignItems="center" paddingLeft={2} key={`r${kind}${en.path}`}>
          {ic(ICON.file, 'file')}
          <Button key={`${kind}${en.path}`} plain label={name} onPress={() => (kind === 'c' ? openConflict($, en.path) : openDiff($, en, kind === 's'))} />
          <Text dimColor wrap="truncate-start">{dir}</Text>
          <Box flexGrow={1} />
          {kind === 's' && <Button key={`un${en.path}`} label="−" onPress={() => act($, 'Unstaged', ['restore', '--staged', '--', en.path])} />}
          {kind === 'u' && <Button key={`st${en.path}`} label="+" onPress={() => act($, 'Staged', ['add', '--', en.path])} />}
          <Text bold color={kind === 'c' ? '#c74e39' : (STATUS[code] ?? '#e2c08d')}>{code}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} width="100%">
        <Box alignItems="center" gap={1}>
          <Text bold>SOURCE CONTROL</Text>
          <Box flexGrow={1} />
          {ic(ICON.branch, 'branch')}
          <Text bold>{s.branch}</Text>
          {s.sync && <Text dimColor>{s.sync}</Text>}
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>

        {header('main', 'Changes')}
        {isOpen('main') && (
          <Box flexDirection="column" gap={1} paddingLeft={2}>
            <Box gap={1} alignItems="center">
              <Box flexGrow={1}>
                <Input key="msg" placeholder={`Message (Ctrl+Enter to commit on "${s.branch}")`} value={s.msg} submitLabel="↵"
                  onInput={v => update($, sc, x => ({ ...x, msg: v }))} onSubmit={() => commit($, false, false)} />
              </Box>
              <Button key="gen" label="✨" onPress={() => generate($)} />
            </Box>
            <Box gap={1} alignItems="center" width="100%">
              <Box flexGrow={1}>
                <Button key="commit" variant="primary" label="✓ Commit" onPress={() => commit($, false, false)} />
              </Box>
              <Select key="more" options={[
                { value: 'commit', label: 'Commit' }, { value: 'amend', label: 'Commit (Amend)' },
                { value: 'push', label: 'Commit & Push' }, { value: 'sync', label: 'Commit & Sync' },
                { value: 'pushonly', label: 'Push' }, { value: 'pull', label: 'Pull' }, { value: 'fetch', label: 'Fetch' },
                { value: 'undo', label: 'Undo Last Commit' }, { value: 'stageall', label: 'Stage All Changes' }, { value: 'unstageall', label: 'Unstage All Changes' },
              ]} onSelect={v => menu($, v)} />
            </Box>
            {s.note && <Text dimColor>{s.note}</Text>}

            {conflicts.length > 0 && header('conf', 'Merge Conflicts', conflicts.length, '#c74e39')}
            {conflicts.length > 0 && isOpen('conf') && conflicts.map(x => row(x, 'c'))}
            {staged.length > 0 && header('staged', 'Staged Changes', staged.length)}
            {staged.length > 0 && isOpen('staged') && staged.map(x => row(x, 's'))}
            {header('changes', 'Changes', changes.length)}
            {isOpen('changes') && changes.map(x => row(x, 'u'))}
            {s.entries.length === 0 && <Text dimColor>No changes.</Text>}
          </Box>
        )}

        {header('graph', 'Graph')}
        {isOpen('graph') && s.log.map((r: LogRow, i: number) => (
          <Box gap={1} alignItems="center" paddingLeft={2} key={`g${r.hash}`}>
            <Svg source={dot(s.log.length > 1)} alt="commit" width={14} height={22} />
            <Text bold={i === 0} wrap="truncate-end">{r.subject}</Text>
            {r.refs && <Text backgroundColor="#3794ff" color="black"> {r.refs.replace('HEAD -> ', '')} </Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
