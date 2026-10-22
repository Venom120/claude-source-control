export type Entry = { x: string; y: string; path: string }
export type Block = { ours: string[]; theirs: string[]; pick: string | null }
export type Seg = string | Block
export type LogRow = { hash: string; subject: string; refs: string; author: string; email: string; rel: string; date: string; body: string; stat: string }
export type SC = {
  view: 'list' | 'diff' | 'conflict' | 'commit'
  root: string
  isRepo: boolean
  branch: string
  sync: string
  entries: Entry[]
  log: LogRow[]
  graphRows: number
  midScroll: number
  graphScroll: number
  confirm: string
  collapsed: string[]
  msg: string
  msgRev: number
  simple: boolean
  pathInput: string
  note: string
  file: string
  diff: string
  segs: Seg[]
  editing: number
}

declare module 'claude-code' {
  interface PluginState {
    'claude-source-control': { sc: SC }
  }
}
