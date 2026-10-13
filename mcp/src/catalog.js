// Pure queries over the Azure VM catalog (same file as cld2day.com uses).
// Catalog shape: { generatedUtc, currency, regions:[{name,displayName}],
//   skus:[{name, slug, series, category, vcpus, memoryGiB, gpus, tempDiskGiB, maxDataDisks, maxNics,
//          acceleratedNetworking, premiumStorage, arch, prices:{region:{l,w,r1,r3,s1,s3}}}] }
// Prices are USD per hour per VM. Reservations and savings plans cover compute only.

export const HOURS_PER_MONTH = 730;
const SITE = "https://cld2day.com";

export const WORKLOADS = {
  general: ["General purpose"],
  compute: ["Compute optimized"],
  memory: ["Memory optimized"],
  storage: ["Storage optimized"],
  gpu: ["GPU"],
  hpc: ["High performance compute"],
  confidential: ["Confidential compute"],
  burstable: ["General purpose (burstable)"],
};

// Searched when no workload is given: burstable, confidential and "Other" sizes are opt-in.
const ANY_WORKLOAD = new Set([
  "General purpose", "Compute optimized", "Memory optimized", "Storage optimized", "GPU", "High performance compute",
]);

const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const compact = (s) => String(s || "").toLowerCase().replace(/^standard[_\s-]?/, "").replace(/[\s_\-]/g, "");

export function sizeUrl(sku) {
  return `${SITE}/tools/azure-vm/${encodeURIComponent(sku.slug || sku.name.toLowerCase())}`;
}

/** Index for fast lookups; build once per catalog. */
export function indexCatalog(catalog) {
  const byName = new Map();
  const byCompact = new Map();
  for (const sku of catalog.skus || []) {
    byName.set(sku.name.toLowerCase(), sku);
    if (!byCompact.has(compact(sku.name))) byCompact.set(compact(sku.name), sku);
  }
  const regions = new Map((catalog.regions || []).map((r) => [r.name.toLowerCase(), r.displayName || r.name]));
  return { catalog, byName, byCompact, regions };
}

/** Accepts "Standard_D4s_v5", "standard_d4s_v5", "D4s_v5" or "D4s v5". */
export function lookupSize(idx, input) {
  if (!input) return null;
  const s = String(input).trim();
  return idx.byName.get(s.toLowerCase()) || idx.byName.get(("standard_" + s).toLowerCase()) || idx.byCompact.get(compact(s)) || null;
}

/** Accepts "westeurope" or "West Europe"; returns the ARM name or null. */
export function resolveRegion(idx, input) {
  if (!input) return null;
  const key = String(input).toLowerCase().replace(/\s+/g, "");
  for (const [name, display] of idx.regions) {
    if (name === key || display.toLowerCase().replace(/\s+/g, "") === key) return name;
  }
  return null;
}

export function regionName(idx, name) {
  return idx.regions.get(String(name).toLowerCase()) || name;
}

const isConstrained = (sku) => sku.name.includes("-");
const offered = (p) => p && p.l > 0;

function rate(p, windows) {
  return windows ? p.w : p.l;
}

/** Commitment rate for Windows = compute commitment + Windows license at pay-as-you-go. */
function commitment(p, key, windows) {
  const v = p[key];
  if (!(v > 0)) return null;
  return windows ? v + ((p.w || 0) - p.l) : v;
}

function priceIn(sku, region, windows) {
  if (region) {
    const p = sku.prices?.[region];
    return offered(p) && rate(p, windows) > 0 ? { region, p } : null;
  }
  let best = null;
  for (const [r, p] of Object.entries(sku.prices || {})) {
    if (!offered(p) || !(rate(p, windows) > 0)) continue;
    if (!best || rate(p, windows) < rate(best.p, windows) || (rate(p, windows) === rate(best.p, windows) && r < best.region)) {
      best = { region: r, p };
    }
  }
  return best;
}

const version = (name) => Number((/_v(\d+)$/i.exec(name) || [, 1])[1]);

/**
 * Sizes that meet every requirement, cheapest first (sort "price") or least spare capacity first (sort "fit").
 * With no region, each size is priced in its cheapest region.
 */
export function findSizes(idx, q = {}) {
  const minVcpus = Math.max(0, Number(q.minVcpus) || 0);
  const minMem = Math.max(0, Number(q.minMemoryGiB) || 0);
  const windows = String(q.os || "linux").toLowerCase() === "windows";
  const region = q.region ? resolveRegion(idx, q.region) : null;
  if (q.region && !region) throw new Error(`Unknown region "${q.region}". Use an ARM name such as westeurope or a display name such as West Europe.`);
  const workload = q.workload ? String(q.workload).toLowerCase() : null;
  if (workload && !WORKLOADS[workload]) throw new Error(`Unknown workload "${q.workload}". Use one of: ${Object.keys(WORKLOADS).join(", ")}.`);
  const categories = workload ? new Set(WORKLOADS[workload]) : ANY_WORKLOAD;
  const arch = q.arch ? (String(q.arch).toLowerCase().startsWith("arm") ? "Arm64" : "x64") : null;
  const take = Math.min(Math.max(Number(q.maxResults) || 10, 1), 50);
  const fit = String(q.sort || "price").toLowerCase() === "fit";

  const excess = (s) =>
    (minVcpus > 0 ? (s.vcpus - minVcpus) / minVcpus : s.vcpus / 64) + (minMem > 0 ? (s.memoryGiB - minMem) / minMem : s.memoryGiB / 512);

  const matches = [];
  for (const sku of idx.catalog.skus || []) {
    if (!categories.has(sku.category) || isConstrained(sku)) continue;
    if (sku.vcpus < minVcpus || sku.memoryGiB < minMem) continue;
    if (arch && sku.arch !== arch) continue;
    if (q.needTempDisk && !(sku.tempDiskGiB > 0)) continue;
    if (q.minGpus && !(sku.gpus >= Number(q.minGpus))) continue;
    const priced = priceIn(sku, region, windows);
    if (!priced) continue;
    matches.push({ sku, ...priced, hourly: rate(priced.p, windows), excess: excess(sku) });
  }

  matches.sort((a, b) =>
    (fit ? a.excess - b.excess || a.hourly - b.hourly : a.hourly - b.hourly || a.excess - b.excess)
    || version(b.sku.name) - version(a.sku.name)
    || a.sku.name.localeCompare(b.sku.name));

  return {
    matchCount: matches.length,
    pricedIn: region ? regionName(idx, region) : "each size's cheapest region",
    os: windows ? "windows" : "linux",
    results: matches.slice(0, take).map((m) => {
      const r3 = commitment(m.p, "r3", windows);
      return {
        size: m.sku.name,
        vcpus: m.sku.vcpus,
        memoryGiB: m.sku.memoryGiB,
        gpus: m.sku.gpus || 0,
        tempDiskGiB: m.sku.tempDiskGiB || 0,
        arch: m.sku.arch,
        category: m.sku.category,
        region: m.region,
        regionName: regionName(idx, m.region),
        payAsYouGoHourly: round(m.hourly, 4),
        payAsYouGoMonthly: round(m.hourly * HOURS_PER_MONTH),
        reserved3yMonthly: r3 ? round(r3 * HOURS_PER_MONTH) : null,
        url: sizeUrl(m.sku),
      };
    }),
  };
}

/** Specs plus prices per region (cheapest Linux first), optionally limited to one region. */
export function describeSize(idx, sizeInput, opts = {}) {
  const sku = lookupSize(idx, sizeInput);
  if (!sku) throw new Error(`Unknown VM size "${sizeInput}". Use a name such as Standard_D4s_v5.`);
  const region = opts.region ? resolveRegion(idx, opts.region) : null;
  if (opts.region && !region) throw new Error(`Unknown region "${opts.region}".`);

  const rows = Object.entries(sku.prices || {})
    .filter(([r, p]) => offered(p) && (!region || r === region))
    .sort(([, a], [, b]) => a.l - b.l)
    .map(([r, p]) => ({
      region: r,
      regionName: regionName(idx, r),
      linuxHourly: p.l ?? null,
      windowsHourly: p.w ?? null,
      reserved1yHourly: p.r1 ?? null,
      reserved3yHourly: p.r3 ?? null,
      savingsPlan1yHourly: p.s1 ?? null,
      savingsPlan3yHourly: p.s3 ?? null,
      linuxMonthly: round(p.l * HOURS_PER_MONTH),
    }));

  return {
    size: sku.name,
    series: sku.series,
    category: sku.category,
    vcpus: sku.vcpus,
    memoryGiB: sku.memoryGiB,
    gpus: sku.gpus || 0,
    tempDiskGiB: sku.tempDiskGiB || 0,
    maxDataDisks: sku.maxDataDisks,
    maxNics: sku.maxNics,
    acceleratedNetworking: !!sku.acceleratedNetworking,
    premiumStorage: !!sku.premiumStorage,
    arch: sku.arch,
    offeredInRegions: Object.values(sku.prices || {}).filter(offered).length,
    prices: rows,
    notes: region && rows.length === 0 ? `${sku.name} is not offered in ${regionName(idx, region)}.` : undefined,
    url: sizeUrl(sku),
  };
}

/**
 * Monthly cost per pricing option. Pay as you go is billed for the hours the VM runs; reservations and
 * savings plans are commitments billed for every hour (730 per month), whether the VM runs or not.
 */
export function estimateCost(idx, { size, region, os = "linux", hoursPerMonth = HOURS_PER_MONTH, instances = 1 }) {
  const sku = lookupSize(idx, size);
  if (!sku) throw new Error(`Unknown VM size "${size}".`);
  const windows = String(os).toLowerCase() === "windows";
  const r = region ? resolveRegion(idx, region) : null;
  if (region && !r) throw new Error(`Unknown region "${region}".`);
  const priced = priceIn(sku, r, windows);
  if (!priced) throw new Error(`${sku.name} has no ${windows ? "Windows" : "Linux"} price in ${r ? regionName(idx, r) : "any region"}.`);

  const hours = Math.max(Number(hoursPerMonth) || HOURS_PER_MONTH, 1);
  const n = Math.max(Math.floor(Number(instances) || 1), 1);
  const committed = Math.max(hours, HOURS_PER_MONTH);
  const payg = rate(priced.p, windows);

  const option = (key, label, hourly, billedHours) =>
    hourly > 0 ? { option: key, label, hourly: round(hourly, 4), monthly: round(hourly * billedHours * n), yearly: round(hourly * billedHours * n * 12) } : null;

  const options = [
    option("payg", "Pay as you go", payg, hours),
    option("r1", "1-year reservation", commitment(priced.p, "r1", windows), committed),
    option("r3", "3-year reservation", commitment(priced.p, "r3", windows), committed),
    option("s1", "1-year savings plan", commitment(priced.p, "s1", windows), committed),
    option("s3", "3-year savings plan", commitment(priced.p, "s3", windows), committed),
  ].filter(Boolean);

  const paygMonthly = options[0].monthly;
  for (const o of options.slice(1)) {
    o.vsPayAsYouGoPercent = round((o.monthly / paygMonthly - 1) * 100, 1);
    o.breakEvenHoursPerMonth = o.hourly < payg ? Math.ceil((o.hourly * HOURS_PER_MONTH) / payg) : null;
  }
  const cheapest = options.reduce((a, b) => (b.monthly < a.monthly ? b : a));

  return {
    size: sku.name,
    vcpus: sku.vcpus,
    memoryGiB: sku.memoryGiB,
    region: priced.region,
    regionName: regionName(idx, priced.region),
    os: windows ? "windows" : "linux",
    hoursPerMonth: hours,
    instances: n,
    options,
    cheapest: cheapest.option,
    notes: [
      "USD list prices before tax and negotiated discounts. Compute only: disks, bandwidth and backups are extra.",
      "Reservations and savings plans are billed for every hour (730/month) even when the VM is stopped.",
      windows ? "Windows: commitment rates add the Windows license at its pay-as-you-go rate; Azure Hybrid Benefit not applied." : undefined,
    ].filter(Boolean),
    url: `${SITE}/tools/azurevmpricecompare?sizeName=${encodeURIComponent(sku.name)}&region=${priced.region}&operatingSystem=${windows ? "windows" : "linux"}&monthlyHours=${hours}&instanceCount=${n}`,
  };
}

/** Latest weekly change reports (newest first). */
export function priceChanges(log, idx, weeks = 1) {
  const reports = (log?.reports || []).slice(0, Math.min(Math.max(Number(weeks) || 1, 1), 12));
  return reports.map((r) => ({
    week: r.date,
    comparedWith: r.previousDate,
    counts: r.counts,
    newSizes: r.newSizes,
    retiredSizes: r.removedSizes,
    biggestPriceMoves: (r.priceChanges || []).slice(0, 15).map(([size, region, option, before, after]) => ({
      size, region: regionName(idx, region), option, before, after, changePercent: round((after / before - 1) * 100, 1),
    })),
    url: `${SITE}/tools/azure-vm/changes?date=${r.date}`,
  }));
}
