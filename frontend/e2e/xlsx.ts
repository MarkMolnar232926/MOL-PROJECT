import { execFileSync } from "node:child_process";

/** Asset ID column of SAP_Export_Completed, read with the backend's openpyxl. */
export function sapAssetIds(file: string): (number | null)[] {
  const script = [
    "import json, sys",
    "from openpyxl import load_workbook",
    "ws = load_workbook(open(sys.argv[1], 'rb'), read_only=True)['SAP_Export_Completed']",
    "rows = list(ws.iter_rows(values_only=True))",
    "i = list(rows[0]).index('Asset ID')",
    "print(json.dumps([r[i] for r in rows[1:]]))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", script, file], { encoding: "utf-8" }));
}
