import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeVariable,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClickedEvent,
} from 'ag-grid-community';
import type { Finding } from '@payclinic/contracts';
import { toFindingRows, type FindingRow } from '../lib/rows';
import { Badge } from './ui/Badge';
import { severityTone } from './RunProgress';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeQuartz.withPart(colorSchemeVariable);

const severityRenderer = (p: ICellRendererParams<FindingRow>) => (
  <Badge tone={severityTone(String(p.value))}>{String(p.value)}</Badge>
);

const stateRenderer = (p: ICellRendererParams<FindingRow>) => (
  <Badge tone={p.value === 'verified' || p.value === 'protected' ? 'ok' : 'neutral'}>
    {String(p.value)}
  </Badge>
);

const columnDefs: ColDef<FindingRow>[] = [
  { field: 'severity', headerName: 'Severity', cellRenderer: severityRenderer, width: 130 },
  { field: 'scenario', headerName: 'Scenario', width: 120 },
  { field: 'invariant', headerName: 'Invariant', width: 120 },
  { field: 'title', headerName: 'Title', flex: 1, minWidth: 220 },
  { field: 'state', headerName: 'State', width: 140, cellRenderer: stateRenderer },
];

export interface FindingsGridProps {
  runId: string;
  findings: Finding[];
}

export function FindingsGrid({ runId, findings }: FindingsGridProps) {
  const navigate = useNavigate();
  const rows = useMemo(() => toFindingRows(findings), [findings]);

  const onRowClicked = (event: RowClickedEvent<FindingRow>) => {
    if (!event.data) return;
    navigate(`/runs/${runId}/findings/${event.data.id}`);
  };

  return (
    <div data-testid="findings-grid" style={{ width: '100%' }}>
      <AgGridReact<FindingRow>
        theme={gridTheme}
        domLayout="autoHeight"
        rowStyle={{ cursor: 'pointer' }}
        overlayNoRowsTemplate="No findings: every checked invariant passed 🎉"
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true }}
        onRowClicked={onRowClicked}
      />
    </div>
  );
}
