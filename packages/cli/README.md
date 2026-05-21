# ttoksem

A local-first cost ledger for AI usage. Records token spend per workspace,
task, run, and event from Claude Code, Codex, and OpenAI SDK responses;
prices it against versioned rule snapshots; and surfaces it through a CLI
and a local dashboard.

ttoksem records AI usage and cost. It does not execute LLM calls.

## Requirements

Node.js 22.5 or newer (the ledger uses the built-in `node:sqlite` module).

## Install

```bash
npm install -g ttoksem
```

## Quick start

In a project where you use Claude Code, set up the ledger:

```bash
ttoksem init
```

`ttoksem init` creates a local ledger at `.ttoksem/ttoksem.db` and, with your
consent, installs a Claude Code Stop hook that captures token usage
automatically after every turn.

See your usage:

```bash
ttoksem dashboard serve     # local web dashboard
ttoksem report today        # today's cost in the terminal
```

Discover commands interactively:

```bash
ttoksem --help
ttoksem <command> --help
```

## What it does

- Imports token usage from Claude Code and Codex session logs, and from
  OpenAI SDK responses
- Attributes spend to a workspace, task, run, and event
- Prices usage against versioned pricing-rule snapshots
- Surfaces cost through CLI reports and a local dashboard
- Optional Cloudflare D1-backed Worker to share one ledger across machines

## Documentation

Full documentation, architecture notes, and the self-hosting guide:
https://github.com/ttoksem/ttoksem

## License

MIT © johwanghee
