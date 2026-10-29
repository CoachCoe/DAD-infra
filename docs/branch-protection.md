# Branch protection — solo-friendly ruleset (operator handoff)

This repo follows the DAD family convention: a **`main`** branch (default/stable)
and a **`dev`** working branch. Branch protection in the DAD family is configured
in **GitHub repository settings**, not committed to the repo (no CODEOWNERS, no
`.github/settings.yml`, no ruleset files live in the other repos). This document
is the one-time handoff to reproduce a solo-friendly protection setup here.

Nothing in this repo applies these rules automatically. **You** run the commands
below (or click through the GitHub UI). They make live GitHub API calls — they are
not part of the offline verification gate and are not run by any workflow.

## Goal: solo-friendly protection

A single maintainer must be able to self-merge, while still routing every change
through a PR and a passing status check. So:

- Require a pull request before merging to `main` **and** `dev`.
- **0 required approvals** (so you can merge your own PRs without a second person).
- Require the `atm-infra.yml` PR status check (the offline `cdk synth` of both
  envs) to pass before merge.
- Block force-pushes and branch deletion on both branches.
- Do **not** require linear history or signed commits unless the rest of the
  family adopts them (it currently does not).

## Apply with `gh` (recommended)

Requires the GitHub CLI authenticated against `CoachCoe/DAD-infra`. These use the
**rulesets** API (the modern equivalent of classic branch protection). Run each
block once; re-running updates the existing ruleset if you keep the same name.

> The required status check name must match the job as GitHub reports it from
> `atm-infra.yml`. The PR-only offline-synth job is `synth` — confirm the exact
> check name in the Actions UI after the first PR run and adjust `context` below
> if GitHub reports it differently (e.g. `synth (staging)`).

### Ruleset for `main`

```sh
gh api -X POST repos/CoachCoe/DAD-infra/rulesets \
  -f name='protect-main' \
  -f target='branch' \
  -f enforcement='active' \
  -F 'conditions[ref_name][include][]=refs/heads/main' \
  -F 'rules[][type]=pull_request' \
  -F 'rules[][parameters][required_approving_review_count]=0' \
  -F 'rules[][parameters][dismiss_stale_reviews_on_push]=false' \
  -F 'rules[][parameters][require_code_owner_review]=false' \
  -F 'rules[][type]=required_status_checks' \
  -F 'rules[][parameters][required_status_checks][][context]=synth' \
  -F 'rules[][parameters][strict_required_status_checks_policy]=true' \
  -F 'rules[][type]=non_fast_forward' \
  -F 'rules[][type]=deletion'
```

### Ruleset for `dev`

Same rules, different target branch:

```sh
gh api -X POST repos/CoachCoe/DAD-infra/rulesets \
  -f name='protect-dev' \
  -f target='branch' \
  -f enforcement='active' \
  -F 'conditions[ref_name][include][]=refs/heads/dev' \
  -F 'rules[][type]=pull_request' \
  -F 'rules[][parameters][required_approving_review_count]=0' \
  -F 'rules[][parameters][dismiss_stale_reviews_on_push]=false' \
  -F 'rules[][parameters][require_code_owner_review]=false' \
  -F 'rules[][type]=required_status_checks' \
  -F 'rules[][parameters][required_status_checks][][context]=synth' \
  -F 'rules[][parameters][strict_required_status_checks_policy]=true' \
  -F 'rules[][type]=non_fast_forward' \
  -F 'rules[][type]=deletion'
```

### Set `main` as the default branch

```sh
gh api -X PATCH repos/CoachCoe/DAD-infra -f default_branch='main'
```

## Apply via the GitHub UI (alternative)

Settings → Rules → Rulesets → New branch ruleset, once per branch:

1. **Name**: `protect-main` / `protect-dev`; **Enforcement**: Active.
2. **Target branches**: Include `main` (then a second ruleset for `dev`).
3. Enable **Require a pull request before merging**, set **Required approvals = 0**.
4. Enable **Require status checks to pass**, add the `synth` check, tick
   **Require branches to be up to date** (strict).
5. Enable **Block force pushes** and **Restrict deletions**.
6. Leave **Require linear history** and **Require signed commits** off (match the
   family).

Settings → General → Default branch → set to `main`.

## Verify

```sh
gh api repos/CoachCoe/DAD-infra/rulesets
gh api repos/CoachCoe/DAD-infra --jq '.default_branch'
```

Both rulesets should show `enforcement: active`; the default branch should be
`main`.
```