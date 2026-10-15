#!/usr/bin/env node
// azure-vm-pricing-mcp: Azure VM sizes and USD list prices for AI assistants (stdio MCP server).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { describeSize, estimateCost, findSizes, indexCatalog, priceChanges, WORKLOADS } from "./src/catalog.js";
import { loadCatalog, loadChanges } from "./src/data.js";

const server = new McpServer({ name: "azure-vm-pricing", version: "0.1.4" });

let index;
async function idx() {
  index ??= indexCatalog(await loadCatalog());
  return index;
}

// Every answer says where the numbers come from and how fresh they are.
async function provenance() {
  const { catalog } = await idx();
  return {
    pricesAsOf: catalog.generatedUtc || null,
    currency: catalog.currency || "USD",
    source: "Microsoft Azure Retail Prices API (public USD list prices) and az vm list-skus, refreshed weekly",
    dataset: "https://github.com/vdionisopoulos/azure-vm-pricing",
  };
}

async function reply(result) {
  const body = { ...result, dataSource: await provenance() };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}

function fail(err) {
  return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
}

const run = (fn) => async (args) => {
  try {
    return await reply(await fn(args));
  } catch (err) {
    return fail(err);
  }
};

const region = z.string().optional().describe("Azure region, e.g. westeurope or \"West Europe\". Omit to use each size's cheapest region.");
const os = z.enum(["linux", "windows"]).optional().describe("Operating system for pay-as-you-go prices. Default linux.");
const readOnly = { readOnlyHint: true, openWorldHint: false };

server.registerTool("find_vm_sizes", {
  title: "Find Azure VM sizes",
  description: "Find the cheapest Azure VM sizes that meet vCPU, memory and workload requirements, with monthly USD list prices. "
    + "Burstable (B-series) and confidential sizes are only included when that workload is requested.",
  inputSchema: {
    min_vcpus: z.number().int().min(0).max(1024).optional().describe("Minimum vCPUs, e.g. 8."),
    min_memory_gib: z.number().min(0).max(32768).optional().describe("Minimum memory in GiB, e.g. 32."),
    workload: z.enum(Object.keys(WORKLOADS)).optional().describe("Workload family. ai = NVIDIA GPUs only (CUDA, PyTorch, vLLM); gpu = any GPU incl. AMD. Omit for any (excludes burstable and confidential)."),
    region,
    os,
    arch: z.enum(["x64", "arm64"]).optional().describe("CPU architecture."),
    need_temp_disk: z.boolean().optional().describe("Only sizes with a local temporary disk."),
    min_gpus: z.number().int().min(1).max(16).optional().describe("Minimum number of whole GPUs (partitioned GPUs such as 1/6 A10 do not count)."),
    sort: z.enum(["price", "fit"]).optional().describe("price = cheapest first (default); fit = least spare vCPU/memory first."),
    max_results: z.number().int().min(1).max(50).optional().describe("Default 10."),
  },
  annotations: readOnly,
}, run(async (a) => findSizes(await idx(), {
  minVcpus: a.min_vcpus, minMemoryGiB: a.min_memory_gib, workload: a.workload, region: a.region, os: a.os,
  arch: a.arch, needTempDisk: a.need_temp_disk, minGpus: a.min_gpus, sort: a.sort, maxResults: a.max_results,
})));

server.registerTool("get_vm_size", {
  title: "Azure VM size details",
  description: "Specs of one Azure VM size and its hourly USD prices per region (Linux, Windows, 1/3-year reservations, 1/3-year savings plans), cheapest region first.",
  inputSchema: {
    size: z.string().describe("VM size, e.g. Standard_D4s_v5 or D4s v5."),
    region: z.string().optional().describe("Limit prices to one region."),
  },
  annotations: readOnly,
}, run(async (a) => describeSize(await idx(), a.size, { region: a.region })));

server.registerTool("estimate_vm_cost", {
  title: "Estimate Azure VM cost",
  description: "Monthly and yearly cost of one or more Azure VM sizes for pay as you go, reservations and savings plans, "
    + "with the break-even hours per month for each commitment. Use it to compare sizes or regions.",
  inputSchema: {
    sizes: z.array(z.string()).min(1).max(5).describe("One to five VM sizes to price, e.g. [\"Standard_D4s_v5\", \"Standard_D4as_v6\"]."),
    region,
    os,
    hours_per_month: z.number().min(1).max(744).optional().describe("Runtime hours per month. Default 730 (always on)."),
    instances: z.number().int().min(1).max(10000).optional().describe("Number of VMs. Default 1."),
  },
  annotations: readOnly,
}, run(async (a) => {
  const i = await idx();
  const estimates = a.sizes.map((size) => {
    try {
      return estimateCost(i, { size, region: a.region, os: a.os, hoursPerMonth: a.hours_per_month, instances: a.instances });
    } catch (err) {
      return { size, error: err.message };
    }
  });
  return estimates.length === 1 ? estimates[0] : { estimates };
}));

server.registerTool("get_price_changes", {
  title: "Azure VM price changes",
  description: "Weekly report of new Azure VM sizes, retired sizes and the biggest list-price moves across 24 regions.",
  inputSchema: {
    weeks: z.number().int().min(1).max(12).optional().describe("How many weekly reports, newest first. Default 1."),
  },
  annotations: readOnly,
}, run(async (a) => {
  const log = await loadChanges();
  if (!log?.reports?.length) return { message: "No weekly report published yet." };
  return { reports: priceChanges(log, await idx(), a.weeks) };
}));

await server.connect(new StdioServerTransport());
