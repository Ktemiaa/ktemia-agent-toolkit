# Publishing

All three packages share one version and are released together by pushing a `v*`
tag. `.github/workflows/publish.yml` then typechecks, builds, tests, and
publishes `ktemia` followed by `@ktemia/ai-sdk` and `@ktemia/langchain`. There is no npm token in this
repo, in GitHub secrets, or on anyone's machine: releases authenticate with
npm trusted publishing over OIDC, and npm attaches a provenance attestation
tying each file to the commit and workflow run that built it.

A version number cannot be reused. A mistake is corrected by publishing
another version, never by replacing one.

## One-time bootstrap (per package)

npm cannot do a brand-new package's first publish over OIDC. A trusted
publisher is configured on the package's own settings page, and that page does
not exist until the package does, so the first version has to come from a
laptop ([npm/cli#8544](https://github.com/npm/cli/issues/8544); PyPI allows
pre-registration, npm does not).

We publish a `0.0.0` placeholder rather than the real `0.1.0`, so that every
release carrying actual code still comes from CI with provenance.

1. **Publish a placeholder for each name.** In a throwaway directory:

   ```bash
   npm login                       # opens a browser; 2FA here
   cd "$(mktemp -d)"
   for name in ktemia @ktemia/ai-sdk @ktemia/langchain; do
     mkdir -p placeholder && cd placeholder
     cat > package.json <<EOF
   { "name": "$name", "version": "0.0.0",
     "description": "Placeholder. Real releases are published from GitHub Actions." }
   EOF
     npm publish --access public   # --access public matters: scoped packages are private by default
     cd .. && rm -rf placeholder
   done
   ```

   `0.0.0` is the lowest version, so the first real release still becomes
   `latest`. Mark the placeholders so nobody installs one by accident:

   ```bash
   npm deprecate ktemia@0.0.0 "Placeholder. Install 0.1.0 or later."
   npm deprecate @ktemia/ai-sdk@0.0.0 "Placeholder. Install 0.1.0 or later."
   npm deprecate @ktemia/langchain@0.0.0 "Placeholder. Install 0.1.1 or later."
   ```

2. **Configure the trusted publisher for each package.** Needs npm >= 11.15.0
   and account-level 2FA:

   ```bash
   npm trust github ktemia --repo Ktemiaa/ktemia-agent-toolkit \
     --file publish.yml --allow-publish
   npm trust github @ktemia/ai-sdk --repo Ktemiaa/ktemia-agent-toolkit \
     --file publish.yml --allow-publish
   npm trust github @ktemia/langchain --repo Ktemiaa/ktemia-agent-toolkit \
     --file publish.yml --allow-publish
   ```

   Or on npmjs.com: package → Settings → Trusted Publisher → GitHub Actions,
   with owner `Ktemiaa`, repository `ktemia-agent-toolkit`, workflow
   `publish.yml`, no environment.

   **`--allow-publish` is load-bearing.** Trusted publishers created after
   3 September 2026 are allowed `npm stage publish` only unless direct
   publishing is granted explicitly, and this workflow runs `npm publish`.
   Without it the release fails with `ENEEDAUTH`.

3. **Release within 2 days.** A new trusted publisher configuration expires if
   it has not completed a successful publish in that window, and an expired
   one cannot be used or edited - only deleted and recreated. Cut `v0.1.0`
   (below) right after configuring.

4. **Log out of npm**, so no long-lived credential is left in `~/.npmrc`:

   ```bash
   npm logout
   ```

Afterwards, on each package's Settings → Publishing access, select "Require
two-factor authentication and disallow tokens". Trusted publishing keeps
working; token-based publishing stops being possible.

## Release

1. **Bump the version in all three packages.** They always move together, even when
   only one changed:

   - `packages/ktemia/package.json`
   - `packages/ktemia/src/client.ts` (`VERSION`)
   - `packages/ai-sdk/package.json`, including the `ktemia` dependency range
   - `packages/ai-sdk/src/index.ts` (`VERSION`)
   - `packages/langchain/package.json`, including the `ktemia` dependency range
   - `packages/langchain/src/index.ts` (`VERSION`)

   Then `npm install --package-lock-only` so the lockfile follows.

2. **Run the checks locally:**

   ```bash
   npm ci
   npm run typecheck
   npm test
   npx tsc --noEmit -p examples
   npm run test:live        # real API and model; needs .env, spends ~6 requests
   ```

3. **Commit, push to `main`, and wait for CI to pass.**

4. **Tag the commit CI passed on:**

   ```bash
   git tag -a v0.1.0 -m "0.1.0: <one line on what changed>"
   test "$(git rev-parse v0.1.0^{commit})" = "$(git rev-parse origin/main)"
   git push origin v0.1.0
   ```

   Push the commit before the tag: the workflow runs from the tagged commit,
   so a tag pushed ahead of a workflow change releases with the old workflow.
   Never move a tag once pushed; cut the next version instead.

5. **Watch it:** `gh run watch`. The job asserts the tag matches every package
   version before uploading, publishes `ktemia` first because both adapters
   depend on it, and skips any version already on npm, so re-running after a
   partial failure is safe.

npm takes a few minutes to serve a new version and keeps showing the previous
`latest` meanwhile. That is normal.

## Verify like a user

Registry pages are not proof. Install the published packages in a throwaway
directory and run them:

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null
npm i ktemia@0.1.0 @ktemia/ai-sdk@0.1.0 ai zod
node -e "const {ktemiaTools}=require('@ktemia/ai-sdk'); console.log(Object.keys(ktemiaTools({apiKey:'x'})).length)"   # 7
```

Check the provenance attestation exists:

```bash
npm view ktemia dist.attestations
curl -s "https://registry.npmjs.org/-/npm/v1/attestations/ktemia@0.1.0" | head -c 200
```

## If something is wrong

- `npm unpublish` works only within 72 hours and only if nothing depends on the
  version. Prefer `npm deprecate ktemia@<bad> "use <good>"`, which warns on
  install and leaves pinned installs working.
- If one package published and the other failed, fix the cause and re-run the
  job. It uses the same tagged commit and skips what is already on npm.

## Python packages (`ktemia`, `langchain-ktemia`)

Released together from `.github/workflows/publish-python.yml`, separately from the npm packages.

**One-time setup on pypi.org**, for each of `ktemia` and `langchain-ktemia`: Account → Publishing → **Add a pending publisher** (the projects do not exist yet) → GitHub, owner `Ktemiaa`, repository `ktemia-agent-toolkit`, workflow `publish-python.yml`, environment `pypi`. Then create the `pypi` environment under the repository's Settings → Environments.

**Release:**

1. Bump `version` in `python/ktemia/pyproject.toml` and `python/langchain-ktemia/pyproject.toml`, and `VERSION` in each package's `_version.py`.
2. Push to `main` and wait for the Python CI.
3. `git tag -a py-v0.1.1 -m "py-v0.1.1" && git push origin py-v0.1.1`

The workflow checks the tag matches both versions, runs lint and tests, builds both packages, and publishes them with `skip-existing`, so a re-run after a partial failure is safe.
