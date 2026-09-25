import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { useId, useMemo, useState } from "react";
import { useT } from "../i18n";

export const tableFeatureSet = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
});
export type Features = typeof tableFeatureSet;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Columns<T extends RowData> = ColumnDef<Features, T, any>[];
export const columnHelper = <T extends RowData>() => createColumnHelper<Features, T>();

type Props<T extends RowData> = {
  label: string;
  data: T[];
  columns: Columns<T>;
  getRowId: (row: T) => string;
  statusOf?: (row: T) => string;
  statusLabel?: (status: string) => string;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
};

export function DataTable<T extends RowData>({
  label,
  data,
  columns,
  getRowId,
  statusOf,
  statusLabel = (s) => s,
  onRowClick,
  selectedId,
}: Props<T>) {
  const t = useT();
  const statusId = useId();
  const [status, setStatus] = useState("");
  const statuses = useMemo(
    () => (statusOf ? [...new Set(data.map(statusOf))].sort() : []),
    [data, statusOf],
  );
  const rows = useMemo(
    () => (status && statusOf ? data.filter((r) => statusOf(r) === status) : data),
    [data, status, statusOf],
  );
  const table = useTable({
    features: tableFeatureSet,
    columns,
    data: rows,
    getRowId: (row) => getRowId(row),
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: () => true,
  });
  const shown = table.getRowModel().rows;
  const filterValue = (table.state.globalFilter as string | undefined) ?? "";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label={`${t.results.filter} (${label})`}
          placeholder={t.results.filter}
          value={filterValue}
          onChange={(e) => table.setGlobalFilter(e.target.value)}
          className="input w-64"
        />
        {statusOf && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor={statusId}>{t.results.statusFilter}</label>
            <select
              id={statusId}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input"
            >
              <option value="">{t.results.allStatuses}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>
        )}
        <span className="text-sm text-slate-500">{t.results.rowCount(shown.length, data.length)}</span>
      </div>
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm" aria-label={label}>
          <thead className="sticky top-0 bg-slate-100 text-left">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                      }
                      className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-700"
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          <span aria-hidden="true">
                            {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}
                          </span>
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => (e.key === "Enter" || e.key === " ") && onRowClick(row.original)
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                aria-selected={selectedId === row.id || undefined}
                className={`border-t border-slate-100 align-top ${
                  onRowClick ? "cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none" : ""
                } ${selectedId === row.id ? "bg-blue-100" : ""}`}
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-2 py-1">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="p-4 text-sm text-slate-500">{t.results.noRows}</p>}
      </div>
    </div>
  );
}
