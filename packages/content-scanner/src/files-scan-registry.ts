import type { FilesApi } from "@statewalker/webrun-files";
import { readText, writeText } from "@statewalker/webrun-files";
import { FilesScanStore } from "./files-scan-store.js";
import type { ScanRegistry, ScanRegistryOptions, ScanStore } from "./scan-store.js";

const REGISTRY_FILE = "_registry.json";

type RegistryJson = {
  stores: string[];
};

export class FilesScanRegistry implements ScanRegistry {
  private readonly files: FilesApi;
  private readonly prefix: string;
  private readonly openStores = new Map<string, FilesScanStore>();
  private storeNames: string[] | null = null;

  constructor(options: ScanRegistryOptions) {
    this.files = options.files;
    this.prefix = options.prefix ?? "scan";
  }

  private get registryPath(): string {
    return `${this.prefix}/${REGISTRY_FILE}`;
  }

  private async loadNames(): Promise<string[]> {
    if (this.storeNames) return this.storeNames;
    if (await this.files.exists(this.registryPath)) {
      const text = await readText(this.files, this.registryPath);
      if (text) {
        const data = JSON.parse(text) as RegistryJson;
        this.storeNames = data.stores;
        return this.storeNames;
      }
    }
    this.storeNames = [];
    return this.storeNames;
  }

  private async saveNames(): Promise<void> {
    if (!this.storeNames) return;
    await writeText(
      this.files,
      this.registryPath,
      JSON.stringify({ stores: this.storeNames } satisfies RegistryJson),
    );
  }

  async createStore(name: string): Promise<ScanStore> {
    const names = await this.loadNames();
    if (names.includes(name)) {
      throw new Error(`Store already exists: ${name}`);
    }
    names.push(name);
    await this.saveNames();

    const store = new FilesScanStore(name, this.files, `${this.prefix}/${name}`);
    this.openStores.set(name, store);
    return store;
  }

  async getStore(name: string): Promise<ScanStore | null> {
    const existing = this.openStores.get(name);
    if (existing) return existing;

    const names = await this.loadNames();
    if (!names.includes(name)) return null;

    const store = new FilesScanStore(name, this.files, `${this.prefix}/${name}`);
    this.openStores.set(name, store);
    return store;
  }

  async hasStore(name: string): Promise<boolean> {
    const names = await this.loadNames();
    return names.includes(name);
  }

  async getStoreNames(): Promise<string[]> {
    return [...(await this.loadNames())];
  }

  async deleteStore(name: string): Promise<void> {
    const names = await this.loadNames();
    const idx = names.indexOf(name);
    if (idx === -1) {
      throw new Error(`Store not found: ${name}`);
    }
    names.splice(idx, 1);
    this.openStores.delete(name);
    await this.saveNames();

    // Remove store directory recursively
    const storeDir = `${this.prefix}/${name}`;
    if (await this.files.exists(storeDir)) {
      // Collect all files first, then delete
      const paths: string[] = [];
      for await (const info of this.files.list(storeDir, { recursive: true })) {
        if (info.kind === "file") {
          paths.push(info.path);
        }
      }
      for (const p of paths) {
        await this.files.remove(p);
      }
    }
  }

  async flush(): Promise<void> {
    await this.saveNames();
  }

  async close(): Promise<void> {
    this.openStores.clear();
    this.storeNames = null;
  }
}
