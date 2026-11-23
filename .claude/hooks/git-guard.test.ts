import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs hook without types
import { blockReason } from './git-guard.mjs'

const local = {}
const blocked = (c: string) => blockReason(c, local) !== null

describe('git-guard hook', () => {
  it('blocks commands that touch other sessions\' files', () => {
    for (const c of [
      'git add -A',
      'git add --all',
      'git add .',
      'git add -u',
      'git stash',
      'git stash push -m x',
      'git checkout master',
      'git checkout -- src/a.ts',
      'git switch -c x',
      'git restore src/a.ts',
      'git reset --hard HEAD',
      'git clean -fd',
      'npm test && git add -A && git commit -m x',
    ])
      expect(blocked(c), c).toBe(true)
  })

  it('lets safe commands through', () => {
    for (const c of [
      'git add src/a.ts src/b.ts',
      'git add ./src/a.ts',
      'git commit -m "add . later"',
      'git status',
      'git stash list',
      'git restore --staged src/a.ts',
      'git reset src/a.ts',
      'git push origin master',
      'npm run verify',
    ])
      expect(blocked(c), c).toBe(false)
  })

  it('stays off in cloud sessions, which have their own clone', () => {
    expect(blockReason('git add -A', { CLAUDE_CODE_REMOTE: 'true' })).toBeNull()
  })
})
