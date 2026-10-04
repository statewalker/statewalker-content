> **This repository is archived.** `@statewalker/content-extractors` now lives in
> [statewalker/statewalker-search](https://github.com/statewalker/statewalker-search/tree/main/packages/content-extractors),
> with this repository's history. Published versions 0.2.0 and later come from there.

# statewalker-content

Content extraction: turn PDF, DOCX, XLSX, Markdown, and HTML into markdown text.

## Packages

<!-- List every package under `packages/` here with a one-line description and a link. Kept in sync by `scripts/new-monorepo.ts` and audited by `scripts/validate-migration.ts`. -->

| Package | Description |
| --- | --- |
| [@statewalker/content-extractors](packages/content-extractors) | PDF/DOCX/XLSX/Markdown/HTML extractors producing markdown text via a mime-aware registry. |

## Apps

| App | Description |
| --- | --- |
| [indexer-tests](apps/indexer-tests) | Integration tests for the indexer stack. |

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
