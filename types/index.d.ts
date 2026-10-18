export type Entry = { x: string; y: string; path: string }
export type Block = { ours: string[]; theirs: string[]; pick: string | null }
export type Seg = string | Block
export type LogRow = { hash: string; subject: string; refs: string }
export type SC = {
  view: 'list' | 'diff' | 'conflict'
  root: string
  isRepo: boolean
  branch: string
  sync: string
  entries: Entry[]
  log: LogRow[]
  collapsed: string[]
  msg: string
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
