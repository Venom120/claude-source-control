import { test, expect } from 'claude-code/testing'
import { parseStatus, parseConflicts, joinSegs, refPills, parseLog, commitTip } from './register'

test('parses status and conflicts', () => {
  const s = parseStatus('## main...origin/main [ahead 1]\nUU a.txt\n M b.txt\n?? c.txt\n')
  expect(s.branch).toBe('main')
  expect(s.sync).toBe('ahead 1')
  expect(s.entries.length).toBe(3)
  const segs = parseConflicts('x\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> t\ny')
  expect(segs.length).toBe(3)
  const blk = segs[1] as { pick: string | null }
  blk.pick = 'a\nb'
  expect(joinSegs(segs)).toBe('x\na\nb\ny')
})

test('ref pills', () => {
  expect(refPills('')).toBe(null)
  const p = refPills('HEAD -> main, origin/main, origin/HEAD, tag: v1')
  expect(p!.src.includes('+1')).toBe(true)
  expect(p!.w > 0).toBe(true)
})

test('log hover', () => {
  const RS = String.fromCharCode(30)
  const US = String.fromCharCode(31)
  const NL = String.fromCharCode(10)
  const out = RS + ['abc123', 'Ada', 'a@x.io', '2 days ago', 'Mon Oct 16 2026 10:00', 'HEAD -> main, origin/main', 'fix: thing' + NL + NL + 'long body', NL + NL + ' 2 files changed, 3 insertions(+), 1 deletion(-)'].join(US)
  const [r] = parseLog(out)
  expect(r.subject).toBe('fix: thing')
  expect(commitTip(r).includes('2 files changed')).toBe(true)
  expect(commitTip(r).includes('long body')).toBe(true)
})
