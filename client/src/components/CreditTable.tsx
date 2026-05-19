import React from "react";

export interface CreditTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
}

interface CreditTableProps<T> {
  columns: CreditTableColumn<T>[];
  rows: T[];
  testId?: string;
}

export function CreditTable<T>({ columns, rows, testId }: CreditTableProps<T>) {
  return (
    <div
      className="rounded-xl border border-card-border bg-card shadow-xl ring-1 ring-white/5 overflow-hidden"
      data-testid={testId}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-5 py-3 text-${
                    col.align || "left"
                  } text-[11px] uppercase tracking-wider text-muted-foreground font-medium`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={`${
                  i !== rows.length - 1 ? "border-b border-border/60" : ""
                }`}
                data-testid={`${testId}-row-${i}`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-5 py-3.5 text-${
                      col.align || "left"
                    } text-card-foreground ${col.className || ""}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
