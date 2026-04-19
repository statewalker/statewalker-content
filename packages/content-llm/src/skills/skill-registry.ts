import type { SkillInfo } from "./skill-types.js";

export class SkillRegistry {
  #skills = new Map<string, SkillInfo>();

  /** Register a skill. Returns a function to unregister it. */
  register(skill: SkillInfo): () => void {
    this.#skills.set(skill.name, skill);
    return () => {
      this.#skills.delete(skill.name);
    };
  }

  /** List all registered skills (name + description only). */
  list(): Array<{ name: string; description: string }> {
    return [...this.#skills.values()].map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  /** Get a skill by name. Returns undefined if not found. */
  get(name: string): SkillInfo | undefined {
    return this.#skills.get(name);
  }

  /** Number of registered skills. */
  get size(): number {
    return this.#skills.size;
  }
}
