# GitHub OIDC setup (one-time)

The CI/CD workflow uses **GitHub OIDC** — no long-lived AWS access keys in GitHub secrets.

## Already done (via CLI)

| Resource | Value |
|----------|--------|
| IAM role | `github-actions-rm-main-be-deploy` |
| Role ARN | `arn:aws:iam::080538261697:role/github-actions-rm-main-be-deploy` |
| Trust | `repo:rabahalishah-robustcraft/rm_main_be` on branch `main` |

## Client must verify (AWS console, root/admin)

The deploy IAM user could **not** create the GitHub OIDC provider. If the first workflow run fails with an assume-role error, an admin must add this once:

1. IAM → **Identity providers** → **Add provider**
2. Type: **OpenID Connect**
3. Provider URL: `https://token.actions.githubusercontent.com`
4. Audience: `sts.amazonaws.com`

Or CLI (admin):

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

## GitHub

No repository secrets are required for AWS auth. Push to `main` (or use **Actions → Deploy to ECS → Run workflow**) to deploy.

## What the pipeline does

1. `npm test` on every push to `main`
2. Build Docker image → push to ECR (`latest` + commit SHA)
3. Register new ECS task definition with the SHA-tagged API image
4. Update `rm-main-be-api` and wait for service stability
