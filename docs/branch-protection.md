# Branch protection — solo-friendly rulesets

DAD-infra follows the DAD family convention: **`main`** (default, stable) and **`dev`**
(working branch). The family's shared rules are in DAD-Docs
(`conventions/repos-and-branches.md`). Protection lives in **GitHub repository
settings**, not in the tree, so this document is the record of what is applied and how
to reapply it.

DAD-infra uses repository **rulesets** (not classic branch protection) and protects
**both** `main` and `dev`.

## What is applied

| Setting | Value | Why |
|---|---|---|
| Require a pull request | on | No direct pushes. |
| Required approvals | **0** | A solo owner cannot approve their own PR; raise to 1 when collaborators join. |
| Require conversation resolution | on | No unresolved review threads. |
| Required status check | `synth`, branch up to date | No red merges. |
| Block force-pushes | on | Protects history. |
| Block deletion | on | The branches cannot be deleted. |
| Bypass | repository **admin**, `pull_request` mode | The owner can still merge a PR if a check cannot report. Use it only when a check cannot run, never to merge past one that failed or is still running (DAD-Docs ADR 0005). Does not allow direct pushes. |

### Why `synth` must always run

A required check that never runs blocks the merge forever. Both infra workflows
(`atm-infra.yml`, `dad-main-infra.yml`) therefore have **no `paths:` filter on
`pull_request`**; on every PR each runs the unit tests (`npx jest`) and an offline
`cdk synth` of both environments. Both define a job named `synth`, and the ruleset
requires that name. `dad-main-infra.yml`'s deploy triggers (`push` to `dev` and `main`)
stay path-filtered; `atm-infra.yml` has none. If you rename the `synth` job, update the
ruleset in the same change.

## Apply (one-time per branch)

These make live GitHub API calls. Run them yourself with the GitHub CLI authenticated
as an admin of `CoachCoe/DAD-infra`; no workflow runs them.

`ruleset.json` (for `main`; for `dev`, change `name` and the `include` ref):

```json
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }
  ],
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{ "context": "synth" }]
      }
    },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ]
}
```

`actor_id: 5` is GitHub's built-in **Admin** repository role.

Create:

```sh
gh api -X POST repos/CoachCoe/DAD-infra/rulesets --input ruleset.json
```

Update an existing ruleset (look up its id first):

```sh
id=$(gh api repos/CoachCoe/DAD-infra/rulesets --jq '.[] | select(.name=="protect-main") | .id')
gh api -X PUT "repos/CoachCoe/DAD-infra/rulesets/$id" --input ruleset.json
```

Set the default branch:

```sh
gh api -X PATCH repos/CoachCoe/DAD-infra -f default_branch=main
```

## Verify

```sh
gh api repos/CoachCoe/DAD-infra/rulesets --jq '.[] | {name, enforcement}'
gh api repos/CoachCoe/DAD-infra --jq .default_branch
```

Both rulesets should be `active` and the default branch `main`.

## When collaborators join

Raise `required_approving_review_count` to 1 and reconsider the admin bypass.
