---

description: Undo every uncommitted change and prove the project is back to normal

---

1. Run `git status --short` and show the list of changed files.

2. Run `git restore .` to put every tracked file back to the last commit.

3. Run `node tools/build-context.js` so context/bundle.js matches the files again.

4. Run `git status --short` again. Untracked files (lines starting with ??) are NOT deleted; list them for me.

5. Run `node tools/validate.js` (about 2 minutes) and report its last line.

6. Reply with a table: step, result. Do not change or delete anything else (keep var/ and logs/).