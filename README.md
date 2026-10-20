# claude-source-control

A VS Code-style **Source Control** pane for Claude Desktop, built as a Claude mod/plugin.

- Collapsible **Changes**, **Staged Changes**, **Merge Conflicts** and **Graph** sections
- Stage / unstage per file, click a file for a real syntax-highlighted diff
- Commit, Commit (Amend), Commit & Push, Commit & Sync, Push, Pull, Fetch, Undo Last Commit
- ✨ AI-generated commit message from your diff
- Merge-conflict resolution: Accept Current / Incoming / Both, or hand-edit, then Mark resolved
- A **Source Control · branch · N** button above the prompt opens the pane; `/source-control` does too (it never opens by itself)

## Install

In Claude Code / Claude Desktop:

```
/plugin marketplace add Venom120/claude-source-control
/plugin install claude-source-control@claude-source-control
```

Restart the session; the pane opens from the button above the prompt or `/source-control`.

## Use

The pane works on the session's working folder. If that folder isn't a git repo, type a repository path into the box (it is remembered) or press **Initialize Repository**.

## Limits

Plugins can only draw with Claude's own elements (boxes, text, buttons, inputs, SVG, a diff viewer), so this approximates VS Code's look rather than copying it. A plugin cannot add a toolbar or sidebar icon. The conflict "Edit" box is single-line (type `\n` for new lines). No discard-changes, branch switching or stash yet.

## Develop

```
claude plugin validate .
claude plugin test .
```

MIT licensed.

## Update

```
claude plugin marketplace update claude-source-control
claude plugin update claude-source-control@claude-source-control
```

Then restart Claude.
