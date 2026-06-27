import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  empty,
  className,
}: DataTableProps<T>) {
  if (data.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/70 hover:bg-muted/70">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn("font-semibold text-foreground", column.className)}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                No records yet.
              </TableCell>
            </TableRow>
          ) : (
            data.map((row, rowIndex) => (
              <TableRow key={getRowKey(row, rowIndex)}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
