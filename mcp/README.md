# azure-vm-pricing-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants answer Azure VM sizing and cost questions with real data. It covers every Azure VM size, its specs, and USD list prices in 24 regions, refreshed weekly.

Ask your assistant things like:

- *"Cheapest VM with 8 vCPU and 32 GB in West Europe?"*
- *"What does a D4s_v5 cost per month on a 3-year reservation vs pay as you go?"*
- *"Compare D4s_v5 and D4as_v6 for 3 Windows VMs running business hours."*
- *"Which Azure VM prices changed this week?"*

Runs locally on your machine. No API key, no account. The data comes from the open [Azure VM pricing dataset](https://github.com/vdionisopoulos/azure-vm-pricing) and is cached for 24 hours.

## Install

Requires Node.js 18 or newer.

**Claude Desktop**: add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "azure-vm-pricing": { "command": "npx", "args": ["-y", "azure-vm-pricing-mcp"] }
  }
}
```

**Claude Code**:

```bash
claude mcp add azure-vm-pricing -- npx -y azure-vm-pricing-mcp
```

**VS Code (GitHub Copilot)**: add this to `.vscode/mcp.json`:

```json
{ "servers": { "azure-vm-pricing": { "command": "npx", "args": ["-y", "azure-vm-pricing-mcp"] } } }
```

**Cursor and other clients**: use the command `npx -y azure-vm-pricing-mcp`.

## Tools

| Tool | What it does |
|---|---|
| `find_vm_sizes` | Cheapest sizes that meet minimum vCPU and memory, workload, region, OS, CPU architecture, temp disk or GPU requirements. Sort by price or closest fit. |
| `get_vm_size` | Specs of one size and its hourly prices per region: Linux, Windows, 1/3-year reservations, 1/3-year savings plans. |
| `estimate_vm_cost` | Monthly and yearly cost of up to 5 sizes for pay as you go, reservations and savings plans, with break-even hours per month. |
| `get_price_changes` | Weekly report of new sizes, retired sizes and the biggest price moves. |

Every result links to the matching page on [cld2day.com](https://cld2day.com/tools/azure-vm).

## How costs are calculated

- **Pay as you go**: hourly rate × hours per month × instances.
- **Reservations and savings plans**: billed for every hour (730 a month) whether the VM runs or not. That is why pay as you go wins for VMs that are stopped most of the time, and why each commitment comes with a break-even point in hours per month.
- **Windows**: commitment rates add the Windows license at its pay-as-you-go rate. Azure Hybrid Benefit is not applied.
- **Not included**: taxes, negotiated discounts (EA, MCA, CSP), disks, bandwidth and backups.

## Configuration

| Variable | Default |
|---|---|
| `AZURE_VM_PRICING_DATA_URL` | `https://raw.githubusercontent.com/vdionisopoulos/azure-vm-pricing/main/data` |
| `AZURE_VM_PRICING_CACHE_DIR` | `<os temp>/azure-vm-pricing-mcp` |

## License

MIT. The dataset is CC BY 4.0. Not affiliated with Microsoft.
