# Prompt Improver for Claude Code

Prompt Improver is an opt-in Claude Code plugin that turns a rough request into a more complete, actionable prompt. It considers the current conversation and a small, read-only selection of project context, then checks the rewrite for fidelity and usefulness.

## Install

Requires Claude Code v2.1.287 or later.

```bash
claude plugin marketplace add gal1ce/prompt-improver-marketplace
claude plugin install prompt-improver@prompt-improver-marketplace
```

Run `/reload-plugins` in Claude Code if the plugin is already open. Check `/plugin` to confirm it is active.

## Use

Append `--improve` to the end of a prompt:

```text
Look into why the login flow fails after password reset. Don't change authentication behavior. --improve
```

The plugin rewrites only marked prompts. It aims to clarify the goal and, where useful, make context, work steps, deliverables, constraints, and completion criteria explicit. It preserves the user's intent and avoids adding unsupported requirements. Prompts without `--improve` pass through unchanged.

## Context and privacy

For marked prompts, the plugin sends the original request, recent conversation excerpts, and a bounded project overview to the model configured for the current Claude Code session. The project overview includes a one-level root listing and excerpts from common instruction, README, and manifest files; it does not recursively scan or read arbitrary source files. Model calls use the configured account/provider and add usage. Each marked prompt typically makes two model calls (rewrite and review), and can make up to four when cold-snapshot fallbacks are needed.

## Local development

See [the plugin README](plugins/prompt-improver/README.md) for behavior details, local loading, and validation commands.

## License

MIT. See [LICENSE](LICENSE).
