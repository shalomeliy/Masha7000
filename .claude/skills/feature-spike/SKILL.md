---
name: feature-spike
description: Before building any new capability from scratch, write a small throwaway experiment (spike) that tests the riskiest assumption and decides whether the feature is feasible and worth building. Use after write-feature-spec is approved and before architecture-plan; skip for small, clear changes and for features built only from parts already proven in this project.
---

# Feature spike: prove it before building it

Goal: spend as little code as possible to learn whether the full feature is feasible and worth the effort. A spike is an experiment, not a first version.

## Steps

1. Read the approved spec (`docs/specs/<feature>.md`). Name the one to three assumptions that, if false, kill or reshape the feature (the API exists and returns what we need, the library does X, it runs fast enough, the model output is good enough, the data is there).
2. Write down, before coding, the question, the success criterion and the failure criterion for each assumption. Measurable when possible (a number, a yes/no, a sample output).
3. Write the smallest code that answers them, in `spikes/<feature>/`. Hard-coded inputs, no UI polish, no error handling beyond what the test needs, no tests suite, no integration into product code. Aim for one file and well under 100 lines.
4. Run it and capture the real output. Never report a result that was not run.
5. Write `docs/spikes/<feature>.md`: question, what was built, how it was run, actual output, and a verdict:
   - **GO**: works and worth building. List what the plan must reuse or watch out for.
   - **CHANGE**: works only with a different approach or reduced scope. Say what changes in the spec.
   - **NO-GO**: not feasible or not worth it. Say why, with the evidence.
6. Show the user the verdict in a few lines and wait for their decision before `architecture-plan`.

## Rules

- Spike code never ships. Product code is written fresh by `loop-engineering` from the approved plan; copying a proven snippet is fine.
- Time-box it: if the spike itself grows into the feature, stop and report what is still unknown.
- No secrets in spike files. Read keys from the environment.
- A NO-GO is a successful spike: it saved building the whole feature.
