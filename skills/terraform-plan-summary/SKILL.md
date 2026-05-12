---
name: terraform-plan-summary
description: Parses noisy Terraform or GitLab CI job logs and produces a concise impact summary (add/change/destroy counts, per-resource actions, grouped repetitive changes, key attribute diffs, warnings). Use when summarizing terraform plan output, CI plan jobs, long job logs, or when the user asks what a plan would change.
---

# Terraform plan summary

## When invoked

Read the full log the user provides (or the attached file). Produce a **short, scannable summary** of infrastructure impact—not a replay of refresh noise.

## Step 1: Normalize the log

1. **Strip GitLab runner prefixes** (optional but recommended): lines often look like  
   `2026-04-01T16:50:55.916324Z 01O ` followed by Terraform text. Remove the ISO timestamp + stream code + space so Terraform lines start at column 0.
2. **Strip ANSI escape sequences**: remove `\x1b[...m` (or literal `[0m`, `[32m`, etc. as they appear in saved logs).
3. **Ignore** (do not summarize as plan changes):
   - `Refreshing state...`, `Reading...`, `Read complete after`
   - `terraform init`, provider download, module init, backend messages
   - Docker/yum/git submodule/section_start noise
   - Shell echoes except use them as **section headers** (see below)

## Step 2: Detect multiple plans in one job

CI jobs may run several `terraform plan` invocations sequentially. Treat each block separately.

**Section labels**: use the most recent preceding `echo "..."` or distinctive script line (e.g. `Terraform plan for dev deployment`, `Auth0 tenant terraform plan`, `Lambda terraform plan`, `kubernetes terraform plan`, `deploy apps to dev-blue`) as the subsection title.

For each subsection, capture:

- Outcome: **`No changes.`** / **equivalent** _or_ the **`Plan: X to add, Y to change, Z to destroy.`** line (exact counts).
- Whether **`terraform plan`** failed (`Error:` / non-zero would appear in log).

## Step 3: Extract resource-level actions

Terraform announces each changed resource with a line matching this pattern (after normalization):

```text
  # <address> will be created
  # <address> will be destroyed
  # <address> will be updated in-place
  # <address> must be replaced
```

Parse `<address>` (e.g. `module.apps["runs-server"].kubernetes_deployment_v1.app`, `aws_iam_policy.example`).

**Classify**:

| Phrase                   | User-facing label          |
| ------------------------ | -------------------------- |
| will be created          | add                        |
| will be destroyed        | destroy                    |
| will be updated in-place | change (in-place)          |
| must be replaced         | replace (destroy + create) |

## Step 4: Group repetitive resources

If many addresses share the same **resource type and change kind** (e.g. dozens of `module.platform_cloud.auth0_client.*` all "updated in-place"):

- State the **count** and **pattern** once.
- List **at most 3** example addresses, then `… and N more similar`.

Do **not** group resources that differ in action (create vs update) or that are high-risk (destroy, replace)—list those explicitly or in a short bullet list.

## Step 5: High-signal attribute changes (optional depth)

When the user needs "what actually changes" beyond addresses:

- Under each resource (or grouped family), pull lines that show **`~ attribute =` … `->`** (before/after).
- Prefer: `image`, `version`, `cidr`, `policy`, `arn`, `name`, `replicas`, `enabled`, `tags`, `lifecycle`, `ingress`, `rule`—skip blocks that are only `unchanged attributes hidden`.
- For **identical** changes across many resources (e.g. same container image tag bump), state **once**: "All N deployments: image `old` → `new`".

## Step 6: Warnings and errors

- Summarize **`Warning:`** blocks (count + first line + resource/file if shown).
- Call out **`Error:`** / **`╷`** diagnostic blocks with the **primary** message; do not omit failures.

## Output template

Use this structure (omit empty sections):

```markdown
## Terraform plan summary

### <Section label> (from CI echo or working directory context)

- **Plan**: X add, Y change, Z destroy — _or_ **No changes.**
- **Adds** (count): …
- **Changes** (count): … grouped …
- **Destroys / replaces** (count): …
- **Notable attribute updates**: …
- **Warnings**: …
- **Errors**: …

### <Next section>

…
```

## Platform example (multi-stack plan job)

A typical CI job runs plans for several stacks in sequence: `terraform/aws/dev`, `terraform/auth0/dev-tenant`, `terraform/lambda/dev`, then `terraform/apps/dev-blue` or `dev-green` depending on a deploy-color variable. Expect **up to four** subsections; one path may be skipped per run.

## Machine-assisted parsing (optional)

If the user wants a local one-shot filter before pasting:

```bash
# Strip common GitLab prefix and ANSI (requires perl)
perl -pe 's/^\d{4}-\d{2}-\d{2}T\S+\s+\S+\s+//; s/\e\[[0-9;]*m//g' job.log > cleaned.log
```

Then `rg 'will be (created|destroyed|updated in-place)|must be replaced|^Plan:|No changes\\.' cleaned.log`

---

Keep the final summary **under ~40 lines** unless the user asks for full resource enumeration.
