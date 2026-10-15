// GPU model per Azure VM size, from the size name (same table as cld2day.com).
// az vm list-skus reports no GPU count for some AMD sizes and reports partitioned GPUs as whole ones,
// so the documented values from Microsoft Learn win here.

const MODELS = [
  [/_GB200_/i, "GB200", "NVIDIA", "GPU"],
  [/_H200_/i, "H200", "NVIDIA", "GPU"],
  [/_H100_/i, "H100", "NVIDIA", "GPU"],
  [/_A100_|^Standard_ND96asr_v4$/i, "A100", "NVIDIA", "GPU"],
  [/_A10_/i, "A10", "NVIDIA", "GPU"],
  [/_T4_/i, "T4", "NVIDIA", "GPU"],
  [/RTXPRO6000/i, "RTX PRO 6000", "NVIDIA", "GPU"],
  [/^Standard_NC\d+r?s_v3$|^Standard_ND\d+rs_v2$/i, "V100", "NVIDIA", "GPU"],
  [/^Standard_NV\d+s_v[23]$/i, "Tesla M60", "NVIDIA", "GPU"],
  [/_MI300X_/i, "Instinct MI300X", "AMD", "GPU"],
  [/^Standard_NV\d+as_v4$/i, "Instinct MI25", "AMD", "GPU"],
  [/_V710_/i, "Radeon Pro V710", "AMD", "GPU"],
  [/_V620_/i, "Radeon Pro V620", "AMD", "GPU"],
  [/^Standard_NP\d+s$/i, "Alveo U250", "AMD Xilinx", "FPGA"],
];

const SHARES = {
  standard_nv6ads_a10_v5: "1/6", standard_nv12ads_a10_v5: "1/3", standard_nv18ads_a10_v5: "1/2",
  standard_nv4as_v4: "1/8", standard_nv8as_v4: "1/4", standard_nv16as_v4: "1/2",
  standard_nv4ads_v710_v5: "1/6", standard_nv8ads_v710_v5: "1/3", standard_nv12ads_v710_v5: "1/2",
  standard_ng8ads_v620_v1: "1/4", standard_ng16ads_v620_v1: "1/2",
};

const COUNTS = { standard_nd96is_mi300x_v5: 8, standard_nd128isr_ndr_gb200_v6: 4 };

/** { model, vendor, kind, count, share, cudaAiStack, label } or null for CPU-only sizes. */
export function gpuOf(sku) {
  const key = sku.name.toLowerCase();
  for (const [re, model, vendor, kind] of MODELS) {
    if (!re.test(sku.name)) continue;
    const share = SHARES[key] || null;
    const count = share ? 1 : COUNTS[key] || Math.max(sku.gpus || 0, 1);
    const cudaAiStack = vendor === "NVIDIA" && kind === "GPU" && model !== "Tesla M60";
    return { model, vendor, kind, count, share, cudaAiStack, label: `${share || count} × ${vendor} ${model}` };
  }
  return sku.gpus > 0
    ? { model: "GPU", vendor: null, kind: "GPU", count: sku.gpus, share: null, cudaAiStack: false, label: `${sku.gpus} × GPU` }
    : null;
}
