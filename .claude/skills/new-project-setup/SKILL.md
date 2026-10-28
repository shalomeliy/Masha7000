---
name: new-project-setup
description: Turn a fresh copy of the base template into a real project. Use when CLAUDE.md still says Project name TEMPLATE and the working folder is not the template folder named in CLAUDE.md, or the user says they are starting a new project from the template.
---

# New project setup

This folder was copied from the user's base template. Before any feature work, turn it into this project's own setup.

## 1. Ask, once, in one message

Ask only what you cannot find in the folder or the user's request:

- Project name.
- What it is and who it is for (one or two sentences).
- Project type: website, web app, API, script, other.
- Stack, if the user already chose one. If not, propose one default and say why.

Do not invent product direction. If the user does not know yet, write `TBD` and move on.

## 2. Fill CLAUDE.md "Project facts"

- Replace `TEMPLATE` with the project name.
- Fill project type, stack, verify command (the single command that builds and tests everything) and product direction.
- For a website: set a performance budget. Default to Google's "Good" Core Web Vitals thresholds: LCP up to 2.5s, INP up to 200ms, CLS up to 0.1.
- Leave the routing, pipeline, agents and substitutes sections as they are.

## 3. Write `docs/PRODUCT-DIRECTION.md`

Short: problem, target user, the main decision or job they come to do, what success looks like, explicit non-goals. Only what the user said; mark assumptions.

## 4. Remove template-only material

- Delete `docs/TEMPLATE-ROADMAP.md` (it is the template's own backlog, not this project's).
- Remove the "This folder is a template" section from CLAUDE.md (including its base-skills list and template rules) and the routing row for this skill.
- Add this section to CLAUDE.md, word for word, right after "Project facts":

```markdown
## Project skills

Base skills (inherited from the template): `architecture-plan`, `ce-compound`, `ce-compound-refresh`, `ce-debug`, `ce-simplify-code`, `drop-generic-design`, `loop-engineering`, `rtl-chat`, `ui-ux-review`, `write-feature-spec`, and the agents `architecture-expert`, `change-reviewer`, `design-expert`, `product-expert`, `qa-expert`, `security-expert`.

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
```

  Copy the base list from the template's "Base skills vs project skills" section before deleting it, so it stays accurate if the base set changed, and drop `new-project-setup` from it.
- If the folder has no git repository, ask whether to run `git init`. Do not create remotes or push.

## 5. Confirm

Report in a few lines what was filled, what is still `TBD`, and the next step: usually `write-feature-spec` for the first feature.

## Rules

- Do not delete any skill or agent. Skills that do not fit the project type stay; routing in CLAUDE.md already limits when they run.
- Do not copy secrets, API keys or account IDs from anywhere. Ask the user to put them in an env file that is gitignored.
