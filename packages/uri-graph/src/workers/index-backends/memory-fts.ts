export interface FtsHit {
  scope: string;
  score: number;
}

export interface FtsBackend {
  upsert(scope: string, docs: string[]): void;
  remove(scope: string): void;
  query(text: string): FtsHit[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Tiny inverted index keyed by scope. Score = number of distinct query terms
 * that appear in the scope's documents.
 */
export function createMemoryFtsBackend(): FtsBackend {
  // term → set of scopes that contain it.
  const termIndex = new Map<string, Set<string>>();
  // scope → set of terms it contributed (so we can remove cleanly).
  const scopeTerms = new Map<string, Set<string>>();

  function dropScope(scope: string): void {
    const terms = scopeTerms.get(scope);
    if (!terms) return;
    for (const t of terms) {
      const set = termIndex.get(t);
      if (!set) continue;
      set.delete(scope);
      if (set.size === 0) termIndex.delete(t);
    }
    scopeTerms.delete(scope);
  }

  return {
    upsert(scope, docs) {
      dropScope(scope);
      const terms = new Set<string>();
      for (const d of docs) for (const t of tokenize(d)) terms.add(t);
      for (const t of terms) {
        let set = termIndex.get(t);
        if (!set) {
          set = new Set();
          termIndex.set(t, set);
        }
        set.add(scope);
      }
      scopeTerms.set(scope, terms);
    },
    remove(scope) {
      dropScope(scope);
    },
    query(text) {
      const queryTerms = tokenize(text);
      const score = new Map<string, number>();
      for (const t of queryTerms) {
        const set = termIndex.get(t);
        if (!set) continue;
        for (const scope of set) {
          score.set(scope, (score.get(scope) ?? 0) + 1);
        }
      }
      const hits: FtsHit[] = [];
      for (const [scope, s] of score) hits.push({ scope, score: s });
      hits.sort((a, b) => b.score - a.score || a.scope.localeCompare(b.scope));
      return hits;
    },
  };
}
