export interface VectorHit {
  id: string;
  score: number;
}

export interface VectorBackend {
  upsert(id: string, vec: Float32Array): void;
  remove(id: string): void;
  search(query: Float32Array, k: number): VectorHit[];
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function createMemoryVectorBackend(): VectorBackend {
  const vectors = new Map<string, Float32Array>();
  return {
    upsert(id, vec) {
      vectors.set(id, vec);
    },
    remove(id) {
      vectors.delete(id);
    },
    search(query, k) {
      const hits: VectorHit[] = [];
      for (const [id, v] of vectors) {
        hits.push({ id, score: cosineSim(query, v) });
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, k);
    },
  };
}
