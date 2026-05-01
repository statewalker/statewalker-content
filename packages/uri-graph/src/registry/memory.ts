import type { ProcessorRegistry, ResourceProcessor } from "../types.js";

export class MemoryProcessorRegistry implements ProcessorRegistry {
  private processors = new Map<string, ResourceProcessor>();

  async saveProcessor(processor: ResourceProcessor): Promise<void> {
    this.processors.set(processor.name, { ...processor });
  }

  async deleteProcessor(name: string): Promise<void> {
    this.processors.delete(name);
  }

  async getProcessor(name: string): Promise<ResourceProcessor | undefined> {
    const p = this.processors.get(name);
    return p ? { ...p } : undefined;
  }

  async *listProcessors(): AsyncIterable<ResourceProcessor> {
    for (const p of this.processors.values()) yield { ...p };
  }
}
