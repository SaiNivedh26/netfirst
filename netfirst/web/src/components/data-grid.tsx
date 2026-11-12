"use client"

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community"
import { AgGridReact } from "ag-grid-react"

ModuleRegistry.registerModules([AllCommunityModule])

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-geist-sans)",
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  headerBackgroundColor: "#f8fafc",
  headerTextColor: "#475569",
  borderColor: "#e5e9f0",
  rowBorder: { color: "#eef1f5" },
  wrapperBorderRadius: 12,
  accentColor: "#0070ba",
  rowHoverColor: "#f3f7fd",
  oddRowBackgroundColor: "#ffffff",
  spacing: 7,
})

export function DataGrid<T>({ rows, columns, height = 360, loading }: { rows: T[] | undefined; columns: ColDef<T>[]; height?: number; loading?: boolean }) {
  return (
    <div style={{ height }}>
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        loading={loading}
        defaultColDef={{ sortable: true, resizable: true, filter: true, flex: 1, minWidth: 110 }}
        animateRows
        suppressCellFocus
        overlayNoRowsTemplate="<span style='color:#64748b;font-size:13px'>No records yet</span>"
      />
    </div>
  )
}
