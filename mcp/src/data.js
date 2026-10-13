// Loads the public dataset with a 24-hour local cache, so the server works offline after the first run.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.AZURE_VM_PRICING_DATA_URL
  || "https://raw.githubusercontent.com/vdionisopoulos/azure-vm-pricing/main/data";
const CACHE_DIR = process.env.AZURE_VM_PRICING_CACHE_DIR || join(tmpdir(), "azure-vm-pricing-mcp");
const TTL_MS = 24 * 60 * 60 * 1000;

async function cached(file, { optional = false } = {}) {
  const path = join(CACHE_DIR, file);
  const fresh = await stat(path).then((s) => Date.now() - s.mtimeMs < TTL_MS, () => false);
  if (fresh) return JSON.parse(await readFile(path, "utf8"));

  try {
    const res = await fetch(`${BASE}/${file}`, { headers: { "User-Agent": "azure-vm-pricing-mcp" } });
    if (res.status === 404 && optional) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const data = JSON.parse(text);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path, text, "utf8");
    return data;
  } catch (err) {
    // Network down or source moved: fall back to a stale copy if we have one.
    const stale = await readFile(path, "utf8").then(JSON.parse, () => null);
    if (stale) return stale;
    if (optional) return null;
    throw new Error(`Could not load ${file} from ${BASE}: ${err.message}`);
  }
}

let catalogPromise;
let changesPromise;

export const loadCatalog = () => (catalogPromise ??= cached("azure-vm-sku-catalog.json").catch((e) => { catalogPromise = undefined; throw e; }));
export const loadChanges = () => (changesPromise ??= cached("azure-vm-price-changes.json", { optional: true }));
