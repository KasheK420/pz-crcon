# Contributing to pz-crcon

First off — thanks for considering contributing. This is an early-stage project and contributions of all kinds (code, docs, design, ideas, bug reports) are welcome.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## Quick Links

- 🐛 **Bug?** → [Open a bug report](https://github.com/KasheK420/pz-crcon/issues/new?template=bug_report.yml)
- 💡 **Feature idea?** → [Open a feature request](https://github.com/KasheK420/pz-crcon/issues/new?template=feature_request.yml)
- ❓ **Question?** → [Discussions](https://github.com/KasheK420/pz-crcon/discussions)
- 🔒 **Security issue?** → See [SECURITY.md](SECURITY.md), do **not** open a public issue

## Development Setup

> Project is in early scaffolding. Setup will be documented here once the tech stack is finalized.

## Branching

- `main` — protected, releasable. PRs only, reviews required.
- Feature branches: `feat/<short-description>` or `fix/<short-description>`
- Releases tagged as `v0.1.0`, `v0.2.0`, etc. (semver)

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Examples:

```
feat: add Discord OAuth login
fix(rcon): handle disconnected server gracefully
docs: clarify setup steps in README
chore(deps): bump next from 15.0.1 to 15.0.3
test: add e2e tests for player ban flow
```

Commits without a Conventional Commit prefix may be squashed/edited at merge time.

## Pull Requests

1. Fork the repo and create a feature branch from `main`
2. Make your changes — keep them focused (one feature/fix per PR)
3. Add or update tests where relevant
4. Update docs if behavior or APIs changed
5. Run linters and tests locally before pushing
6. Open a PR — fill in the template, link related issues
7. Wait for CI green + at least one review

PRs that touch the public API, Lua mod protocol, or database schema may need extended review.

## Testing

> Test conventions will be documented here once the test framework is chosen.

## Style

- Follow the existing patterns in the codebase
- Run the configured linters/formatters before committing
- Don't reformat unrelated code in feature PRs (separate `style:` PR if needed)

## Licensing

By submitting a contribution, you agree that your work is provided under the [MIT License](LICENSE) of this project.

## Recognition

All contributors are listed in [CONTRIBUTORS.md](CONTRIBUTORS.md) (auto-generated). Thank you!
