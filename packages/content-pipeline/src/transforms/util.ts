import type { DocumentPath } from "@statewalker/indexer-api";

/** Coerce a URI into the `/…` DocumentPath shape required by indexer-api. */
export function uriToDocPath(uri: string): DocumentPath {
  return (uri.startsWith("/") ? uri : `/${uri}`) as DocumentPath;
}
