# statewalker-content

Content pipeline: blocks, extractors, scanners, managers, plus the content-cli.

## Packages

<!-- List every package under `packages/` here with a one-line description and a link. Kept in sync by `scripts/new-monorepo.ts` and audited by `scripts/validate-migration.ts`. -->

| Package | Description |
| --- | --- |
| [@statewalker/content-blocks](packages/content-blocks) | Block types shared across the content pipeline. |
| [@statewalker/content-extractors](packages/content-extractors) | PDF/DOCX/XLSX/Markdown/HTML extractors. |
| [@statewalker/content-scanner](packages/content-scanner) | Scans a file tree and streams blocks into indexers. |
| [@statewalker/content-manager](packages/content-manager) | High-level scan + index orchestration. |

## Apps

| App | Description |
| --- | --- |
| [content-cli](apps/content-cli) | CLI wrapping the content pipeline (scan / index / query). |

## Development

```sh
pnpm install
pnpm run build
pnpm run test
```

## Release

Releases are managed via [changesets](https://github.com/changesets/changesets):

```sh
pnpm changeset           # describe the change
pnpm version-packages    # roll versions + regenerate CHANGELOGs
pnpm release-packages    # publish to npm
```
