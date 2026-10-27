# Prompt Improver

A small Claude Code mod that rewrites a submitted prompt only when its final token is `--improve`.

## Behavior

- Rebuilds marked prompts as clear, actionable requests rather than only correcting spelling or formatting. Depending on the task, it can add useful background from the conversation, concrete work steps, deliverables, constraints, and completion criteria while keeping the original scope.
- Works on the submitted prompt in the current interactive session.
- Uses `$.model.fork()` to preserve the session model and context when a reusable model snapshot is available; accepts the documented `{ text, usage }` reply shape.
- If the fork has no reusable snapshot or returns no text, retries with `$.model.complete()` using a bounded excerpt of recent user/assistant messages and the current session model.
- For marked prompts only, adds a bounded, read-only project overview: one-level root listing plus excerpts from common instruction, README, and project manifest files.
- Before sending the prompt onward, runs a synchronous fidelity and usefulness review against the original request. The reviewer accepts a useful, supported elaboration or returns one repair if the rewrite is too shallow, loses constraints, or invents unsupported work; it does not loop.
- If the reviewer fails or returns invalid output, the initial rewrite is sent and the transcript log says the reviewer was unavailable.
- Sends the rewritten text through the same session turn; the suffix is removed.
- Sends unmarked prompts through unchanged.
- If the rewrite calls fail or return no text, sends the original request without the marker and logs the fallback reason.
- Does not recursively scan the repository or read arbitrary source files. Project context collection is best-effort; if unavailable, rewriting still uses the conversation context.

Project context is capped at 80 top-level entries, 2,400 characters per selected file, and 11,000 characters overall. The selected files are `CLAUDE.md`, `AGENTS.md`, `README.md`, common language/build manifests, `Makefile`, and `.claude/CLAUDE.md` when present. Their contents are passed to the rewrite model as quoted data, not as instructions that supersede the rewrite task.

Examples:

```text
Investigate why the login test fails; don't change auth behavior. --improve
Explain how the migration flow we discussed works. --improve
```

## Install from the public marketplace

```bash
claude plugin marketplace add gal1ce/prompt-improver-marketplace
claude plugin install prompt-improver@prompt-improver-marketplace
```

Then run `/reload-plugins` in Claude Code. To use it, add `--improve` as the final token of a prompt.

## Load from a local checkout

From a second shell, run these commands from the root of the repository used by the active Claude Code session. The `local` scope keeps the setup limited to this checkout:

```bash
claude plugin marketplace add --scope local "/path/to/prompt-improver-marketplace"
claude plugin install prompt-improver@prompt-improver-marketplace --scope local
```

Then return to the existing Claude Code session and run `/reload-plugins`. Check `/plugin` and confirm the mod appears as active. To remove the trial afterward, run these from the same repository root:

```bash
claude plugin uninstall prompt-improver@prompt-improver-marketplace --scope local
claude plugin marketplace remove prompt-improver-marketplace --scope local
```

To load it in a separate trial session without installing it:

```bash
claude --plugin-dir "/path/to/prompt-improver-marketplace/plugins/prompt-improver"
```

The marketplace files stay in this output directory, so keep it in place while the plugin is installed from this local marketplace.

## Validation

```bash
node "plugins/prompt-improver/tests/smoke.test.mjs"
claude plugin validate "plugins/prompt-improver"
claude plugin validate "."
```

This prototype requires Claude Code v2.1.287 or later for mods. Model calls use the current session's configured account/provider and add usage. The mod can see submitted prompts and session context, as required for rewriting. Each marked prompt typically makes two model calls (rewrite and review), and can make up to four if both calls need cold-snapshot fallbacks. Unmarked prompts make no model calls.
