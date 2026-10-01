# Publishing to the Visual Studio Marketplace

`.github/workflows/release.yml` publishes on a `vX.Y.Z` tag. It follows
Microsoft's
[secure automated publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
guidance, adapted from Azure Pipelines to GitHub Actions: a user-assigned
managed identity in Microsoft Entra ID trusts this repository's
`vs-marketplace` environment through a federated credential, the identity is a
Contributor on the `hew-lang` publisher, and `vsce publish --azure-credential`
uses the token `azure/login` obtains. There is no personal access token
(Marketplace PATs retire on 1 December 2026).

## One-time setup

1. **Create the identity.** Azure portal → Managed Identities → Create.
   Subscription: yours. Resource group: new, `hew-publishing`. Name:
   `vscode-hew-publisher`. After creation, note from its Overview the
   **Client ID**, and the **Tenant ID** and **Subscription ID**.
2. **Give it Reader.** Resource group `hew-publishing` → Access control (IAM)
   → Add role assignment → Reader → Members: Managed identity →
   `vscode-hew-publisher`.
3. **Trust this repository.** `vscode-hew-publisher` → Settings → Federated
   credentials → Add credential → scenario "GitHub Actions deploying Azure
   resources":
   - Organization `hew-lang`, Repository `vscode-hew`
   - Entity type **Environment**, environment name `vs-marketplace`
   - Name `github-vs-marketplace`

   This yields issuer `https://token.actions.githubusercontent.com`, subject
   `repo:hew-lang/vscode-hew:environment:vs-marketplace` and audience
   `api://AzureADTokenExchange`.
4. **Create the environment.** GitHub → vscode-hew → Settings → Environments
   → New environment `vs-marketplace`:
   - Required reviewers: yourself. Leave "Prevent self-review" off.
   - Deployment branches and tags: Selected branches and tags; add tag rule
     `v*` and branch rule `main`.
   - Environment variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
     `AZURE_SUBSCRIPTION_ID` with the values from step 1.
5. **Read the identity's Marketplace ID.** Actions → Release → Run workflow,
   mode `identity`; approve the deployment. The run summary shows the ID.
6. **Add it to the publisher.**
   [Publisher management](https://marketplace.visualstudio.com/manage/publishers/hew-lang)
   → Members → Add → paste the ID → role **Contributor**.
7. **Restrict release tags.** Settings → Rules → Rulesets → New tag ruleset,
   target `v*`, restrict creations, updates and deletions to administrators.
8. **Dry run.** Actions → Release → Run workflow, mode `package`: tests and
   all five packages, no publish.
9. Revoke any remaining Marketplace PAT for `hew-lang`.

## Releasing

Bump `version` in `package.json`, update `CHANGELOG.md`, push the commit and a
`v<version>` tag on it, then approve the `vs-marketplace` deployment. The
publish step first runs `vsce verify-pat --azure-credential hew-lang`, so a
missing publisher membership fails before anything is uploaded.

To bundle a newer hew language server, replace `hew-release.sha256` with that
release's lines from its `checksums.txt` (the five archives other than
FreeBSD).
