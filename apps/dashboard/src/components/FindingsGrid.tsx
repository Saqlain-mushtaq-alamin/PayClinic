import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClickedEvent,
} from 'ag-grid-community';
import type { Finding } from '@payclinic/contracts';
import { toFindingRows, type FindingRow } from '../lib/rows';

ModuleRegistry.registerModules([AllCommunityModule]);

const severityRenderer = (params: ICellRendererParams<FindingRow>) => (
  <span className="severity-badge">{String(params.value)}</span>
);

const columnDefs: ColDef<FindingRow>[] = [
  { field: 'severity', headerName: 'Severity', cellRenderer: severityRenderer, width: 130 },
  { field: 'scenario', headerName: 'Scenario', width: 120 },
  { field: 'invariant', headerName: 'Invariant', width: 120 },
  { field: 'title', headerName: 'Title', flex: 1, minWidth: 220 },
  { field: 'state', headerName: 'State', width: 130 },
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
    <div data-testid="findings-grid" style={{ height: 360, width: '100%' }}>
      <AgGridReact<FindingRow>
        theme={themeQuartz}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true }}
        onRowClicked={onRowClicked}
      />
    </div>
  );
}
