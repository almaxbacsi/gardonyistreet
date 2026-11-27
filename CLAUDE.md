# CLAUDE.md – Gárdonyi Géza utca (browser 3D game)

Browser 3D walking game set in Gárdonyi Géza utca, Piliscsaba (Three.js + Vite). Not a shooter:
the player is a civilian with suburban tools. See README.md (Hungarian) for the user-facing docs.

## Repository workflow (mandatory)

- **Never push to `main`.** All changes go through a feature branch and a pull request.
- Every piece of work has a **GitHub issue** (the repo lives on GitHub; "tickets" = GitHub issues).
  Create one first if it doesn't exist.
- Keep the issue **status** field current (not labels): `Backlog` → `In progress` when work starts →
  `In review` when the PR is opened → `Done` when it is merged (closing via `Closes #n` also sets it).
  REST: `gh api -X PATCH repos/almaxbacsi/gardonyistreet/issues/<n> -f status="In progress"`.
- Document progress **in issue comments** (brief, cornerstones only): dead-ends and how they were
  resolved, open questions about the goal, decision points and the choice made. When the user
  answers a question, record the answer as a comment too. Mention the merged PR at the end.
- Branch names: `feature/<issue#>-<slug>`, `fix/<issue#>-<slug>`, `chore/<slug>`.
  Branch from the latest `main`; work issues **sequentially** (one branch merged before the next starts)
  unless told otherwise.
- PR title = short imperative summary; PR body: what changed, how it was tested, `Closes #<issue>`.
- Claude may **merge its own PRs** (squash merge) once `npm run build` passes and the change was
  checked visually (headless screenshot). Claude sessions cannot delete remote branches; the repo
  setting "Automatically delete head branches" takes care of that.
- GitHub GraphQL is not available from Claude sessions: use the REST API via `gh api`
  (`repos/almaxbacsi/gardonyistreet/issues`, `/pulls`, `/pulls/<n>/merge`).
- Commit messages and issues/PRs in English; in-game UI text in Hungarian.
- End commit messages with the Co-Authored-By / Claude-Session lines given by the session;
  end PR bodies with the "Generated with Claude Code" line.

## Code conventions

- `src/world/layout.js` is the single place for hand-placed things derived from Street View
  (fences, poles, props, trees, hedges, aprons). Coordinates: `s` = metres along the street from
  the Szent István király útja junction, `d` = lateral offset (+ north-west, − south-east).
- Every placed object registers a stable dev id (`src/dev/registry.js`): ids follow list order
  (`fa-31` = `LANDMARK_TREES[30]`), so **append** to layout lists instead of inserting, or ids shift.
- Data coordinates are x = east, y = north; Three.js world is X = x, Z = −y.
- Heights come only from `heightAt()` / `roadHeight()` in `src/world/geo.js`.
- Code and comments in English. Keep files focused (one system per module).
- Performance matters (runs in a browser): instance or merge static geometry, keep draw calls low,
  gate expensive effects behind quality presets.

## Assets and licensing

- Never use Google Street View imagery as textures or for model extraction; it is reference only.
- Allowed sources: OpenStreetMap (ODbL), CC0 (Poly Haven, ambientCG), the user's own photos
  (`public/textures/sajat/`), models from the three.js examples repo. Note new assets in README.

## Testing

- `npm run build` must succeed.
- Visual check: `vite preview` + headless Chrome screenshot (software WebGL is slow; FPS numbers
  from it are not representative).
