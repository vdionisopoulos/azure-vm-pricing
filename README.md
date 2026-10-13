# Azure VM pricing & specs dataset

Every Azure virtual machine size with its specs and **USD list prices in 24 regions**: Linux and Windows pay as you go, 1- and 3-year reservations, and 1- and 3-year savings plans. Refreshed **every Monday** and published as plain JSON and CSV.

This is the data behind [cld2day.com/tools/azure-vm](https://cld2day.com/tools/azure-vm), the [Azure VM size finder](https://cld2day.com/tools/azurevmsizefinder) and the [Azure VM cost calculator](https://cld2day.com/tools/azurevmpricecompare).

## Files

| File | What it is |
|---|---|
| [`data/azure-vm-prices.csv`](data/azure-vm-prices.csv) | One row per size and region. Sorted, so the git history of this file is the price history. |
| [`data/azure-vm-sku-catalog.json`](data/azure-vm-sku-catalog.json) | Same data, nested by size (compact keys, see below). |
| [`data/azure-vm-price-changes.json`](data/azure-vm-price-changes.json) | Weekly change reports: new sizes, retired sizes, region changes, price moves. |
| [`data/meta.json`](data/meta.json) | Snapshot date and counts. |
| [`mcp/`](mcp) | An MCP server so AI assistants (Claude, Copilot, Cursor) can query this data. |

## CSV columns

`size, region, region_name, category, series, vcpus, memory_gib, gpus, arch, temp_disk_gib, linux_payg_hourly, windows_payg_hourly, reserved_1y_hourly, reserved_3y_hourly, savings_plan_1y_hourly, savings_plan_3y_hourly`

All prices are **USD per hour per VM**. An empty cell means Azure does not sell that option for the size in that region.

## JSON shape

```json
{
  "generatedUtc": "2026-10-20T03:17:00Z",
  "currency": "USD",
  "regions": [{ "name": "westeurope", "displayName": "West Europe" }],
  "skus": [{
    "name": "Standard_D4s_v5", "series": "Dsv5", "category": "General purpose",
    "vcpus": 4, "memoryGiB": 16, "gpus": 0, "tempDiskGiB": 0, "arch": "x64",
    "maxDataDisks": 8, "maxNics": 2, "acceleratedNetworking": true, "premiumStorage": true,
    "prices": { "westeurope": { "l": 0.23, "w": 0.414, "r1": 0.1418, "r3": 0.0909, "s1": 0.1748, "s3": 0.1265 } }
  }]
}
```

`l` Linux pay as you go · `w` Windows pay as you go (license included) · `r1`/`r3` 1-/3-year reservation · `s1`/`s3` 1-/3-year savings plan.

## How it is built

- **Specs**: `az vm list-skus --all --resource-type virtualMachines` in each region (vCPU, memory, GPUs, temporary disk, data disks, NICs, accelerated networking, Premium SSD, CPU architecture).
- **Prices**: the public [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices), USD retail prices.
  - Spot and Low Priority meters are excluded.
  - Reservation prices are published as a term total, so they are converted to an effective hourly rate (÷ 8,760 or ÷ 26,280).
  - Reservations and savings plans cover compute only, so Windows license costs are not included in `r1`/`r3`/`s1`/`s3`.
- Only sizes with a Linux pay-as-you-go price in at least one region are included.

These are list prices before taxes and any negotiated discount (EA, MCA, CSP). Not affiliated with or endorsed by Microsoft.

## Use it from an AI assistant (MCP)

```json
{
  "mcpServers": {
    "azure-vm-pricing": { "command": "npx", "args": ["-y", "azure-vm-pricing-mcp"] }
  }
}
```

Then ask things like *"cheapest 8 vCPU / 32 GB VM in West Europe"* or *"compare D4s_v5 and D4as_v6 on a 3-year reservation"*. See [`mcp/README.md`](mcp/README.md).

## License

Data: [CC BY 4.0](LICENSE). Please credit **cld2day.com** with a link to <https://cld2day.com/tools/azure-vm>. The MCP server code is MIT licensed.

Maintained by Vassilis Dionysopoulos, Principal Cloud Architect ([cld2day.com](https://cld2day.com), [cloudtales.gr](https://cloudtales.gr)).
