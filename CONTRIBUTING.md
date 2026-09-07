# 🐍 Contributing to Medusa

Welcome to the swarm. If you're reading this, you're either a brave soul or a glutton for punishment. Either way, we're glad to have you.

## 📜 The Medusa Code of Conduct
Medusa is a decentralized swarm of autonomous AI agents. We expect humans to be just as efficient, though we know that's a high bar.

1. **Be Sharp:** If your code is as blunt as a butter knife, expect a critique that cuts deep.
2. **Be Autonomous:** Research before you ask. The swarm doesn't spoon-feed.
3. **Be Savage, but Collaborative:** Critical thinking is welcome; personal attacks are for those who can't win with logic.

## 🛠️ Getting Started
1. **Fork the repo.**
2. **Clone your fork.**
3. **Install dependencies:** `npm install` and `pip install -r src/a2a_node/requirements.txt`.
4. **Run the wizard:** `medusa wizard` to ensure your environment is set up.

## 🧬 Development Workflow (Prawduct)
We use a methodology called **Prawduct**. It's not optional.
- **Discovery:** Understand the problem.
- **Planning:** Design the solution in chunks.
- **Building:** One chunk per session.
- **Independent Critic Review:** Every major change is reviewed by a cold, calculating eye.

## 🧪 Testing
If your PR doesn't have tests, it's not a PR; it's a bug report in disguise.
- **Node.js:** `npm test`
- **Python:** `pytest src/a2a_node/tests`

## 📨 Submitting a PR
1. **Create a feature branch:** `git checkout -b feature/my-wicked-feature`.
2. **Commit your changes:** Use clear messages that explain *why*, not just *what*.
3. **Update the CHANGELOG.md:** Add your entry under `[Unreleased]`.
4. **Push to your fork.**
5. **Open a PR:** Explain your changes and why the swarm needs them.

## 🐞 Reporting Bugs
If Medusa breaks, it's probably your fault. But if you're *sure* it's ours:
1. Check the [Existing Issues](https://github.com/Jason-Vaughan/Medusa/issues).
2. Provide a minimal reproduction script.
3. Attach logs from `medusa status --verbose`.

*"Individual intelligence is a spark; collective consensus is the fire."* 🧠🐝🔥

<!-- BEGIN mirrored-security-rules
     MIRRORED from https://github.com/Jason-Vaughan/.github/blob/main/CONTRIBUTING.md
     Edit that file first, then update this copy. Do not let them diverge.
     These markers are load-bearing: a drift checker extracts exactly what lies between
     them, so do not remove, rename or reformat them. -->

## Security rules that apply to every repository

- **Clean-room review.** Pull requests from contributors we do not know are reviewed as raw text
  diffs. Maintainers do not check out your branch or run your code on their own machines. Where a
  repository runs CI on pull requests, those runs are sandboxed by GitHub with a read-only token and
  no access to repository secrets. If your logic is sound we re-implement it and credit you as the
  author.
- **Because we reconstruct it, your explanation is worth more than your code.** Describe the bug
  precisely and explain the approach; a clear description gets shipped, a large unexplained diff
  does not.
- **Scope.** One issue per pull request. A diff touching unrelated files is closed regardless of
  quality — from the outside, scope overrun and probing are indistinguishable.
- **Reviewable text only.** No binary files, and no generated, minified or vendored code. Source
  must contain no bidirectional control characters, no zero-width or invisible characters, and no
  non-ASCII homoglyphs standing in for ASCII in identifiers: those make a diff *render* differently
  from what it *executes* (Trojan Source, CVE-2021-42574), which defeats a text audit by
  construction. Ordinary Unicode in prose, comments and string literals is fine.
- **Security reports:** do not open a public issue. Open this repository's **Security** tab and
  choose **Report a vulnerability** — see the [security policy](../../security/policy).

Full contribution guide: https://github.com/Jason-Vaughan/.github/blob/main/CONTRIBUTING.md
<!-- END mirrored-security-rules -->
