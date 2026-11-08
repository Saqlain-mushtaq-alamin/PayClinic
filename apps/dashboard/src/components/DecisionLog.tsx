import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeVariable,
  themeQuartz,
  type ColDef,
} from 'ag-grid-community';
import type { FirewallDecision } from '@payclinic/contracts';
import { summarizeDecisions, toDecisionRows, type DecisionRow } from '../lib/decisions';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeQuartz.withPart(colorSchemeVariable);

const columnDefs: ColDef<DecisionRow>[] = [
  { field: 'time', headerName: 'Time', width: 200 },
  { field: 'action', headerName: 'Action', width: 110 },
  { field: 'rule', headerName: 'Rule', width: 90 },
  { field: 'reason', headerName: 'Reason', flex: 1, minWidth: 220 },
  { field: 'merchant', headerName: 'Merchant', width: 150 },
  { field: 'sku', headerName: 'SKU', width: 130 },
  { field: 'qty', headerName: 'Qty', width: 80 },
  { field: 'amount', headerName: 'Amount', width: 110 },
];

/** The firewall decision log: count summary plus one grid row per decision. */
export function DecisionLog({ decisions }: { decisions: FirewallDecision[] }) {
  const signature = useMemo(
    () => decisions.map((d) => `${d.id}:${d.action}:${d.ruleId}`).join('|'),
    [decisions],
  );
  const rows = useMemo(() => toDecisionRows(decisions), [decisions, signature]);
  const summary = useMemo(() => summarizeDecisions(decisions), [decisions]);

  return (
    <div className="decision-log">
      <p data-testid="decision-summary">{summary}</p>
      <div data-testid="decision-grid" style={{ width: '100%' }}>
        <AgGridReact<DecisionRow>
          theme={gridTheme}
          domLayout="autoHeight"
          rowData={rows}
          getRowId={(p) => p.data.id}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true }}
          // Blocked attempts are the money-losing rows: tint them red.
          rowClassRules={{
            'decision-log__row--block': (params) => params.data?.action === 'block',
          }}
        />
      </div>
    </div>
  );
}
