import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSize, estimateCost, findSizes, indexCatalog, lookupSize, priceChanges, resolveRegion } from "../src/catalog.js";

const sku = (name, vcpus, memoryGiB, prices, extra = {}) => ({
  name, slug: name.toLowerCase(), series: "T", category: "General purpose", vcpus, memoryGiB, gpus: 0, tempDiskGiB: 0, arch: "x64", prices, ...extra,
});

const idx = indexCatalog({
  regions: [{ name: "westeurope", displayName: "West Europe" }, { name: "eastus", displayName: "East US" }],
  skus: [
    sku("Standard_D2s_v5", 2, 8, { westeurope: { l: 0.115, w: 0.207, r1: 0.071, r3: 0.045, s3: 0.063 }, eastus: { l: 0.096, w: 0.188 } }),
    sku("Standard_D4s_v5", 4, 16, { westeurope: { l: 0.23, w: 0.414, r3: 0.09 } }),
    sku("Standard_D4ps_v5", 4, 16, { westeurope: { l: 0.18 } }, { arch: "Arm64" }),
    sku("Standard_D4ds_v5", 4, 16, { westeurope: { l: 0.27 } }, { tempDiskGiB: 150 }),
    sku("Standard_E4s_v5", 4, 32, { westeurope: { l: 0.30 } }, { category: "Memory optimized" }),
    sku("Standard_B4ms", 4, 16, { westeurope: { l: 0.17 } }, { category: "General purpose (burstable)" }),
    sku("Standard_E8-2s_v5", 2, 64, { westeurope: { l: 0.6 } }, { category: "Memory optimized" }),
  ],
});

test("lookup accepts loose size names and region display names", () => {
  assert.equal(lookupSize(idx, "d4s v5").name, "Standard_D4s_v5");
  assert.equal(lookupSize(idx, "D4s_v5").name, "Standard_D4s_v5");
  assert.equal(lookupSize(idx, "nope"), null);
  assert.equal(resolveRegion(idx, "West Europe"), "westeurope");
  assert.equal(resolveRegion(idx, "mars"), null);
});

test("find: cheapest first, burstable and constrained excluded by default", () => {
  const r = findSizes(idx, { minVcpus: 4, minMemoryGiB: 16, region: "westeurope" });
  assert.deepEqual(r.results.map((x) => x.size), ["Standard_D4ps_v5", "Standard_D4s_v5", "Standard_D4ds_v5", "Standard_E4s_v5"]);
  assert.equal(r.results[1].payAsYouGoMonthly, 167.9);
  assert.equal(r.results[1].reserved3yMonthly, 65.7);
  assert.match(r.results[0].url, /cld2day\.com\/tools\/azure-vm\/standard_d4ps_v5$/);
});

test("find: filters and opt-in workloads", () => {
  assert.deepEqual(findSizes(idx, { minVcpus: 4, workload: "burstable" }).results.map((x) => x.size), ["Standard_B4ms"]);
  assert.deepEqual(findSizes(idx, { minVcpus: 4, needTempDisk: true }).results.map((x) => x.size), ["Standard_D4ds_v5"]);
  assert.deepEqual(findSizes(idx, { minVcpus: 4, arch: "arm64" }).results.map((x) => x.size), ["Standard_D4ps_v5"]);
  assert.throws(() => findSizes(idx, { region: "mars" }), /Unknown region/);
});

test("find: no region prices each size in its cheapest region; windows skips sizes without a Windows price", () => {
  const d2 = findSizes(idx, { minVcpus: 2 }).results.find((x) => x.size === "Standard_D2s_v5");
  assert.equal(d2.region, "eastus");
  const win = findSizes(idx, { minVcpus: 4, os: "windows", region: "westeurope" }).results.map((x) => x.size);
  assert.deepEqual(win, ["Standard_D4s_v5"]);
});

test("estimate: commitments billed for 730 h, Windows license added, break-even", () => {
  const always = estimateCost(idx, { size: "Standard_D2s_v5", region: "westeurope" });
  assert.equal(always.cheapest, "r3");
  const r3 = always.options.find((o) => o.option === "r3");
  assert.equal(r3.monthly, 32.85);
  assert.equal(r3.breakEvenHoursPerMonth, 286); // 0.045 * 730 / 0.115 = 285.7

  const part = estimateCost(idx, { size: "D2s v5", region: "westeurope", hoursPerMonth: 176, instances: 2 });
  assert.equal(part.cheapest, "payg");
  assert.equal(part.options[0].monthly, 40.48);
  assert.equal(part.options.find((o) => o.option === "r3").monthly, 65.7);

  const win = estimateCost(idx, { size: "Standard_D2s_v5", region: "westeurope", os: "windows" });
  assert.equal(win.options.find((o) => o.option === "r3").hourly, 0.137); // 0.045 + (0.207 - 0.115)
});

test("describe: specs and region rows, cheapest first", () => {
  const d = describeSize(idx, "Standard_D2s_v5");
  assert.deepEqual(d.prices.map((p) => p.region), ["eastus", "westeurope"]);
  assert.equal(d.offeredInRegions, 2);
  assert.throws(() => describeSize(idx, "Standard_Nope"), /Unknown VM size/);
});

test("price changes are decoded with region names and percentages", () => {
  const out = priceChanges({ reports: [{ date: "2026-10-20", previousDate: "2026-10-13", counts: {}, newSizes: [], removedSizes: [],
    priceChanges: [["Standard_D2s_v5", "westeurope", "l", 0.1, 0.11]] }] }, idx);
  assert.equal(out[0].biggestPriceMoves[0].region, "West Europe");
  assert.equal(out[0].biggestPriceMoves[0].changePercent, 10);
});

test("gpu: ai workload keeps NVIDIA only, partitioned and AMD GPUs are labelled", async () => {
  const { gpuOf } = await import("../src/gpus.js");
  const g = indexCatalog({
    regions: [{ name: "eastus", displayName: "East US" }],
    skus: [
      sku("Standard_NV4ads_V710_v5", 4, 16, { eastus: { l: 0.33 } }, { category: "GPU", gpus: 0 }),
      sku("Standard_NV6ads_A10_v5", 6, 55, { eastus: { l: 0.45 } }, { category: "GPU", gpus: 1 }),
      sku("Standard_NC4as_T4_v3", 4, 28, { eastus: { l: 0.526 } }, { category: "GPU", gpus: 1 }),
    ],
  });
  assert.deepEqual(findSizes(g, { workload: "ai" }).results.map((x) => x.size), ["Standard_NV6ads_A10_v5", "Standard_NC4as_T4_v3"]);
  assert.equal(findSizes(g, { workload: "gpu" }).results.length, 3);
  assert.deepEqual(findSizes(g, { minGpus: 1 }).results.map((x) => x.size), ["Standard_NC4as_T4_v3"]);   // partitioned GPUs are not whole GPUs
  assert.equal(gpuOf({ name: "Standard_NV6ads_A10_v5", gpus: 1 }).label, "1/6 × NVIDIA A10");
  assert.equal(gpuOf({ name: "Standard_NV4ads_V710_v5", gpus: 0 }).cudaAiStack, false);
  assert.equal(gpuOf({ name: "Standard_ND96is_MI300X_v5", gpus: 0 }).count, 8);
  assert.equal(gpuOf({ name: "Standard_D4s_v5", gpus: 0 }), null);
});
