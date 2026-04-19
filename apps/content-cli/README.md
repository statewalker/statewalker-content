# content-cli

Command-line front end for the `@statewalker/content` pipeline. Scan a directory, extract blocks, index, and query.

## Local dev

```sh
pnpm --filter @statewalker/content-cli start -- <args>
```

## Usage

```sh
pnpm content-cli scan ./docs --index ./idx
pnpm content-cli query ./idx "how do we onboard users?"
```
