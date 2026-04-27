export type Status = "added" | "updated" | "removed";

export interface Update {
  uri: string;
  stamp: number;
  status: Status;
  hash?: string;
  scope?: string;
  role?: string;
  attributes?: Record<string, unknown>;
}

export interface ReadOnlyView {
  uri: string;
  stamp: number;
  status: Status;
  hash?: string;
  attributes?: Record<string, unknown>;
}
