import type { NetworkCell } from './model';

export interface NetworkActivityMonth {
  month: string; og: number; newMembers: number; unclassified: number; active: number; joined: number; retained: number; continuing: number;
  previousActive: number; unresolved: number; ongoing: boolean;
}
export interface NetworkManMonths {
  total: number | null; datedMembers: number; undatedMembers: number;
  months: NetworkActivityMonth[]; partial: boolean;
}
export const utcMonth = (at: number) => new Date(at).toISOString().slice(0, 7);
export function previousMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  return utcMonth(Date.UTC(year, value - 2, 1));
}
export function nextMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  return utcMonth(Date.UTC(year, value, 1));
}
// Signing is the first qualifying action. Later months need positive evidence.
// Read-node gaps and deleted messages cannot establish churn.
export function networkManMonths(cells: NetworkCell[], at: number, available = true): NetworkManMonths {
  const current = utcMonth(at), months = new Map<string, NetworkActivityMonth>();
  let datedMembers = 0, undatedMembers = 0;
  const first = cells.map(c => c.acceptedDay?.slice(0, 7)).filter((m): m is string => Boolean(m && m <= current)).sort()[0];
  if (first) for (let month = first, i = 0; month <= current && i < 1200; month = nextMonth(month), i++) {
    months.set(month, { month, og: 0, newMembers: 0, unclassified: 0, active: 0, joined: 0, retained: 0, continuing: 0, previousActive: 0, unresolved: 0, ongoing: month === current });
  }
  for (const cell of cells) {
    const joined = cell.acceptedDay?.slice(0, 7);
    if (!joined || joined > current) { undatedMembers += cell.count; continue; }
    datedMembers += cell.count;
    const active = new Set([joined, ...(cell.activityMonths ?? []).filter(month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= joined && month <= current)]);
    for (const [month, row] of months) {
      if (month < joined) continue;
      if (active.has(month)) {
        row.active += cell.count;
        if (month === joined) { row.joined += cell.count; if(cell.ogMember===true)row.og+=cell.count;else if(cell.ogMember===false)row.newMembers+=cell.count;else row.unclassified+=cell.count; }
        else { row.continuing += cell.count; if (active.has(previousMonth(month))) row.retained += cell.count; }
      } else row.unresolved += cell.count;
      if (active.has(previousMonth(month))) row.previousActive += cell.count;
    }
  }
  const rows = [...months.values()];
  return { total: available ? rows.reduce((sum, row) => sum + row.active, 0) : null, datedMembers, undatedMembers,
    months: rows, partial: undatedMembers > 0 || rows.some(row => row.unresolved > 0) };
}
