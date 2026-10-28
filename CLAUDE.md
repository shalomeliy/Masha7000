# CLAUDE.md

Reply to the user in Hebrew (masculine form), short and direct, no emojis.

## Project facts

- Project name: `Masha7000`
- Project type: **web app** for managing work shifts.
- Stack: **proposed, not yet approved by the user**: React + TypeScript + Vite, data kept in the browser for the first version, tests with Vitest. Confirm or replace when the first code lands.
- Verify command: **TBD** (expected `npm run verify` once the app exists). Until it exists, `loop-engineering` uses the narrowest real check available and says which one it ran.
- Performance budget: Google "Good" Core Web Vitals: LCP up to 2.5s, INP up to 200ms, CLS up to 0.1.
- Product direction: `docs/PRODUCT-DIRECTION.md`. Do not invent beyond it; ask the user.
- Git: remote `https://github.com/shalomeliy/Masha7000`, branch `master`. Standing rule from the user: at the end of every version, commit and push to that repo.

## Project skills

Base skills (inherited from the template): `architecture-plan`, `ce-compound`, `ce-compound-refresh`, `ce-debug`, `ce-simplify-code`, `drop-generic-design`, `feature-spike`, `loop-engineering`, `rtl-chat`, `ui-ux-review`, `write-feature-spec`, and the agents `architecture-expert`, `change-reviewer`, `design-expert`, `product-expert`, `qa-expert`, `security-expert`.

Skills added for this project only:

- (none yet)

### Adding a skill or agent to this project

Before calling it done:

1. Fill it with this project's real values from "Project facts". No `TBD` left where a value is known.
2. If it only applies to part of the project, say so in its `description`.
3. Point any file paths it writes at the folders in "Where outputs go"; add a row if it needs a new one.
4. Add it to the list above and a row to "Skill routing" (or "Agents").
5. If it references skills that are not installed, add them to the substitutes table.

**Check at the start of every session:** list `.claude/skills/` and `.claude/agents/`. Anything not in the base set or the project list above was added without registration. Run steps 1 to 5 on it and tell the user what was registered.

## Where outputs go

| Output | Path | Written by |
|---|---|---|
| Feature spec | `docs/specs/<feature>.md` | `write-feature-spec` |
| Spike code (throwaway) | `spikes/<feature>/` | `feature-spike` |
| Spike result and verdict | `docs/spikes/<feature>.md` | `feature-spike` |
| Implementation plan | `docs/plans/<feature>-PLAN.md` | `architecture-plan` |
| Solved-problem learnings | `docs/solutions/` | `ce-compound` |

## Skill routing: which skill when

| Situation | Use | Not |
|---|---|---|
| New feature or vague request | `write-feature-spec` | jumping to code |
| Spec approved, new capability | `feature-spike` (small experiment first) | building the full feature on an untested idea |
| Spike verdict GO, need a technical plan | `architecture-plan` | re-opening product decisions |
| Plan approved, build it | `loop-engineering` | building without an approved plan |
| Any frontend work (spec, build, review) | `ui-ux-review` + `drop-generic-design` (via `design-expert`) | decorative polish first |
| Bug, failing test, slow behavior | `ce-debug` | guessing fixes |
| Fix verified and the reasoning is non-obvious | `ce-compound` | documenting routine fixes |
| Feature built and tests pass, code feels messy | `ce-simplify-code` | changing behavior while cleaning |
| `docs/solutions/` may be stale or duplicated | `ce-compound-refresh` | editing product code |
| User asks for RTL widgets in Cowork | `rtl-chat` | turning it on just because text is Hebrew |

Small, clear changes (typo, one-line copy edit, a config value) skip the pipeline. The pipeline is for features.

## Rule: spike before building

The user builds many capabilities from scratch. Before writing the full code of any new capability, always write a small experiment first (`feature-spike`): minimal code that tests the riskiest assumption and shows whether the feature is feasible and worth developing. Only after a GO verdict and the user's approval, plan and build the full capability. Skip only for small, clear changes, or when every part is already proven in this project (say so).

## Feature pipeline

```
write-feature-spec  ->  [user approves spec]
  fan-out: product-expert, architecture-expert, design-expert, qa-expert
           (+ security-expert only on a trust-boundary trigger)
feature-spike       ->  small experiment, verdict GO | CHANGE | NO-GO  ->  [user decides]
architecture-plan   ->  [user approves plan]
loop-engineering    ->  build / check / repair, max 3 cycles
  change-reviewer   ->  PASS | REPAIR | REPLAN | HUMAN DECISION
ce-compound         ->  only if the work taught something non-obvious
```

Bugs found during `loop-engineering` go to `ce-debug`, then back into the loop.

## Agents

| Agent | Called by | Preloaded skills |
|---|---|---|
| `product-expert` | `write-feature-spec` | none |
| `architecture-expert` | `write-feature-spec` | `architecture-plan` |
| `design-expert` | `write-feature-spec`, frontend reviews | `ui-ux-review`, `drop-generic-design` |
| `qa-expert` | `write-feature-spec`, acceptance criteria | none |
| `security-expert` | trust-boundary changes only | none |
| `change-reviewer` | `loop-engineering`, after every build | none |

All agents are read-only. Only the main session edits files.

## compound-engineering skills

`ce-debug`, `ce-compound`, `ce-simplify-code` and `ce-compound-refresh` come from the compound-engineering plugin (EveryInc). They are **copied into `.claude/skills/` on purpose**, because the plugin was not active in the user's Claude Code and a copy travels with the template. Do not also install the full plugin in the same project: that shows each skill twice.

To refresh the copies from a newer plugin version, copy the four folders from `$HOME\.claude\plugins\cache\compound-engineering-plugin` over the ones here.

The plugin also ships skills that overlap this template's own pipeline. For features, use the template's pipeline above, not these:

| Plugin skill | Use instead |
|---|---|
| `ce-brainstorm` | `write-feature-spec` |
| `ce-plan` | `architecture-plan` |
| `ce-work`, `lfg` | `loop-engineering` |
| `ce-code-review` | `change-reviewer` agent |

Git and PR skills (`ce-commit`, `ce-commit-push-pr`, `ce-babysit-pr`, `ce-resolve-pr-feedback`) run only when the user asks and the folder is a git repository.
