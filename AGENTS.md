# Repository safeguards (all contributors and AI agents)

- Never rewrite published history: no force-push, and no rebasing, amending or squashing commits that are already pushed.
- Never run destructive Git operations on shared branches (`reset --hard`, deleting remote branches or tags) without explicit approval.
- Never commit directly to `main`; use feature branches and keep every pushed branch in a working state.
- Commit or push only with explicit approval from the repository owner.
- Keep every change within the explicitly approved task scope: never bundle unrelated changes into a commit, and get approval before expanding the scope.
