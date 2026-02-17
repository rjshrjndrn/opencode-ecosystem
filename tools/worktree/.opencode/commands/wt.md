---
description: Manage git worktrees (list, create, remove, switch)
---

Use the worktree tools to perform the following operation: $ARGUMENTS

If no arguments are provided, list all worktrees using worktree_list.

Rules:

- "list" or no args: call worktree_list
- "create <name>" or "create <name> <base>": call worktree_create with branch=$1 and optionally base=$2
- "remove <target>" or "rm <target>": call worktree_remove with target (path or index number)
- "remove <target> --force" or "rm <target> -f": call worktree_remove with force=true
- "switch <target>" or "sw <target>": call worktree_switch_worktree with target (path or index number)

Only call the appropriate worktree tool. Do not explain what you are doing.
