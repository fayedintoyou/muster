import type { CSSProperties, ReactNode } from 'react';
import type { Grid, GridSlot } from '../core/grid';
import { formatDate, formatMinute, weekdayName } from '../core/format';

// The frame both grids share: night headings across the top, times down the side, one cell per slot.
// Each column is a night, so times after midnight stay under the night they belong to.

export function rowLabel(grid: Grid, row: number): { text: string; minor: boolean; nextDay: boolean } {
  const minute = grid.rows[row].minute;
  const minor = minute % 60 !== 0;
  return {
    text: minor ? `:${String(((minute % 60) + 60) % 60).padStart(2, '0')}` : formatMinute(minute),
    minor,
    nextDay: minute >= 1440,
  };
}

export function columnLabel(grid: Grid, col: number): { weekday: string; date?: string } {
  const c = grid.columns[col];
  return {
    weekday: weekdayName(c.weekday),
    date: grid.mode === 'dates' ? formatDate(c.date) : undefined,
  };
}

/** "Tue 9:30pm" or "Tue Dec 1, 9:30pm", for screen readers and the detail line. */
export function slotLabel(grid: Grid, slot: GridSlot, long = false): string {
  const c = grid.columns[slot.col];
  const day = weekdayName(c.weekday, long ? 'long' : 'short');
  const date = grid.mode === 'dates' ? ` ${formatDate(c.date)}` : '';
  const minute = grid.rows[slot.row].minute;
  const after = minute >= 1440 ? ' (after midnight)' : '';
  return `${day}${date}, ${formatMinute(minute, undefined, false)}${after}`;
}

export function GridFrame({
  grid,
  className,
  renderCell,
  onColumn,
  onRow,
  columnTitle,
  rowTitle,
}: {
  grid: Grid;
  className: string;
  renderCell: (slot: GridSlot) => ReactNode;
  onColumn?: (col: number) => void;
  onRow?: (row: number) => void;
  columnTitle?: (col: number) => string;
  rowTitle?: (row: number) => string;
}) {
  const firstNextDay = grid.rows.findIndex((r) => r.minute >= 1440);
  const style = { '--cols': grid.columns.length, '--rows': grid.rows.length } as CSSProperties;
  return (
    <div className={`slot-grid ${className}`} style={style}>
      <div className="slot-grid-corner" aria-hidden="true" />
      {grid.columns.map((_, col) => {
        const label = columnLabel(grid, col);
        const content = (
          <>
            <span className="col-weekday">{label.weekday}</span>
            {label.date && <span className="col-date">{label.date}</span>}
          </>
        );
        return onColumn ? (
          <button
            type="button"
            key={col}
            className="col-head"
            onClick={() => onColumn(col)}
            title={columnTitle?.(col)}
            aria-label={columnTitle?.(col)}
          >
            {content}
          </button>
        ) : (
          <div key={col} className="col-head">
            {content}
          </div>
        );
      })}
      {grid.rows.map((_, row) => {
        const label = rowLabel(grid, row);
        const head = (
          <>
            <span className={label.minor ? 'row-minor' : 'row-hour'}>{label.text}</span>
          </>
        );
        return [
          onRow ? (
            <button
              type="button"
              key={`h${row}`}
              className="row-head"
              data-midnight={row === firstNextDay || undefined}
              onClick={() => onRow(row)}
              title={rowTitle?.(row)}
              aria-label={rowTitle?.(row)}
            >
              {head}
            </button>
          ) : (
            <div key={`h${row}`} className="row-head" data-midnight={row === firstNextDay || undefined}>
              {head}
            </div>
          ),
          ...grid.columns.map((_, col) => {
            const slot = grid.cells[row][col];
            return slot ? (
              <div
                key={slot.key}
                className="cell-wrap"
                data-midnight={row === firstNextDay || undefined}
                data-midnight-label={(row === firstNextDay && col === grid.columns.length - 1) || undefined}
                data-hour={!label.minor || undefined}
              >
                {renderCell(slot)}
              </div>
            ) : (
              <div
                key={`x${row}-${col}`}
                className="cell-wrap empty"
                aria-hidden="true"
                data-midnight={row === firstNextDay || undefined}
                data-midnight-label={(row === firstNextDay && col === grid.columns.length - 1) || undefined}
              />
            );
          }),
        ];
      })}
    </div>
  );
}
