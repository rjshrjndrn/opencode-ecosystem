/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs/promises"

interface WorktreeEntry {
  path: string
  branch?: string
  commit?: string
  isBare?: boolean
  isMain?: boolean
}

async function run(args: string[], cwd: string) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { stdout: stdout.trim(), stderr: stderr.trim(), code }
}

async function parseWorktreeList(root: string): Promise<WorktreeEntry[]> {
  const result = await run(["worktree", "list", "--porcelain"], root)
  if (result.code !== 0) return []

  const lines = result.stdout.split("\n")
  const entries: WorktreeEntry[] = []
  let current: Partial<WorktreeEntry> = {}

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      if (current.path) entries.push(current as WorktreeEntry)
      current = { path: line.slice("worktree ".length).trim() }
    } else if (line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "")
    } else if (line.startsWith("HEAD ")) {
      current.commit = line.slice("HEAD ".length).trim()
    } else if (line === "bare") {
      current.isBare = true
    } else if (line === "") {
      if (current.path) {
        entries.push(current as WorktreeEntry)
        current = {}
      }
    }
  }

  if (current.path) entries.push(current as WorktreeEntry)

  if (entries.length > 0) entries[0].isMain = true

  return entries
}

async function check(directory: string) {
  const result = await run(["rev-parse", "--git-dir"], directory)
  return result.code === 0
}

export const list = tool({
  description: "List all git worktrees for the current project",
  args: {},
  async execute(_args, context) {
    if (!(await check(context.worktree))) return "Error: Not a git repository"

    const entries = await parseWorktreeList(context.worktree)
    if (entries.length === 0) return "No worktrees found"

    const lines = entries.map((e, i) => {
      const marker = e.isMain ? " (main)" : ""
      const branch = e.branch || "detached"
      return `${i + 1}. [${branch}]${marker} ${e.path}`
    })

    return ["Worktrees:", ...lines].join("\n")
  },
})

export const create = tool({
  description: "Create a new git worktree with the specified branch name",
  args: {
    branch: tool.schema.string().describe("Branch name to create (auto-prefixed with worktree/)"),
    base: tool.schema.string().optional().describe("Base branch or commit (defaults to HEAD)"),
    path: tool.schema.string().optional().describe("Custom path for the worktree"),
  },
  async execute(args, context) {
    if (!(await check(context.worktree))) return "Error: Not a git repository"

    const branch = args.branch.startsWith("worktree/") ? args.branch : `worktree/${args.branch}`
    const base = args.base || "HEAD"

    const target = args.path
      ? path.isAbsolute(args.path)
        ? args.path
        : path.join(path.dirname(context.worktree), args.path)
      : path.join(path.dirname(context.worktree), args.branch)

    const ref = await run(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], context.worktree)
    if (ref.code === 0) return `Error: Branch '${branch}' already exists`

    try {
      await fs.access(target)
      return `Error: Path '${target}' already exists`
    } catch {
      // good
    }

    const result = await run(["worktree", "add", "-b", branch, target, base], context.worktree)
    if (result.code !== 0) return `Error creating worktree: ${result.stderr || result.stdout}`

    return `Created worktree at: ${target}\nBranch: ${branch}\nBase: ${base}`
  },
})

export const remove = tool({
  description: "Remove a git worktree by its path or index from the list",
  args: {
    target: tool.schema.string().describe("Path to the worktree or its index number from the list"),
    force: tool.schema.boolean().optional().default(false).describe("Force removal even with uncommitted changes"),
  },
  async execute(args, context) {
    if (!(await check(context.worktree))) return "Error: Not a git repository"

    const entries = await parseWorktreeList(context.worktree)
    if (entries.length === 0) return "No worktrees found"

    const idx = parseInt(args.target, 10)
    const entry =
      !isNaN(idx) && idx > 0 && idx <= entries.length
        ? entries[idx - 1]
        : entries.find((e) => e.path === args.target || e.path.endsWith(args.target))

    if (!entry) return `Error: Worktree '${args.target}' not found. Use list to see available worktrees.`
    if (entry.isMain) return "Error: Cannot remove the main worktree"

    const cmd = args.force ? ["worktree", "remove", "--force", entry.path] : ["worktree", "remove", entry.path]

    const result = await run(cmd, context.worktree)
    if (result.code !== 0) {
      if (result.stderr.includes("dirty") && !args.force)
        return "Error: Worktree has uncommitted changes. Use force=true to remove anyway."
      return `Error removing worktree: ${result.stderr || result.stdout}`
    }

    if (entry.branch) await run(["branch", "-D", entry.branch], context.worktree)

    return `Removed worktree: ${entry.path}`
  },
})

export const switch_worktree = tool({
  description: "Switch to a different worktree by changing the working directory",
  args: {
    target: tool.schema.string().describe("Path to the worktree or its index number from the list"),
  },
  async execute(args, context) {
    if (!(await check(context.worktree))) return "Error: Not a git repository"

    const entries = await parseWorktreeList(context.worktree)
    if (entries.length === 0) return "No worktrees found"

    const idx = parseInt(args.target, 10)
    const entry =
      !isNaN(idx) && idx > 0 && idx <= entries.length
        ? entries[idx - 1]
        : entries.find((e) => e.path === args.target || e.path.endsWith(args.target))

    if (!entry) return `Error: Worktree '${args.target}' not found. Use list to see available worktrees.`

    try {
      await fs.access(entry.path)
    } catch {
      return `Error: Worktree path '${entry.path}' does not exist`
    }

    return `Switching to worktree: ${entry.path}\n__OPENCODE_CD__:${entry.path}`
  },
})

export default tool({
  description: `Manage git worktrees - create, list, delete, or switch between worktrees.

Available operations:
- list: Show all worktrees with their branches
- create: Create a new worktree with a branch
- remove: Remove a worktree by path or index
- switch: Switch to a different worktree directory

Use the specific operation tools (worktree_list, worktree_create, worktree_remove, worktree_switch_worktree) for better control.`,
  args: {
    operation: tool.schema.enum(["list", "create", "remove", "switch"]).describe("Operation to perform"),
    branch: tool.schema.string().optional().describe("Branch name for create operation"),
    target: tool.schema.string().optional().describe("Target path or index for remove/switch operations"),
    base: tool.schema.string().optional().describe("Base branch for create operation"),
    force: tool.schema.boolean().optional().describe("Force flag for remove operation"),
  },
  async execute(args, context) {
    switch (args.operation) {
      case "list":
        return list.execute({}, context)
      case "create":
        if (!args.branch) return "Error: branch is required for create operation"
        return create.execute({ branch: args.branch, base: args.base }, context)
      case "remove":
        if (!args.target) return "Error: target is required for remove operation"
        return remove.execute({ target: args.target, force: args.force || false }, context)
      case "switch":
        if (!args.target) return "Error: target is required for switch operation"
        return switch_worktree.execute({ target: args.target }, context)
      default:
        return `Unknown operation: ${args.operation}`
    }
  },
})
