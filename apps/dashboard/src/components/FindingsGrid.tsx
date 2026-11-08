import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
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

const gridTheme = themeQuartz.withPart(colorSchemeDark);

const severityRenderer = (p: ICellRendererParams<FindingRow>) => (
  <Badge tone={severityTone(String(p.value))}>{String(p.value)}</Badge>
);

const stateRenderer = (p: ICellRendererParams<FindingRow>) => {
  const val = String(p.value);
  let toneClass = 'badge--neutral';
  if (val === 'verified' || val === 'protected') {
    toneClass = 'badge--ok';
  } else if (val === 'unverified' || val === 'patched') {
    toneClass = 'badge--high';
  } else if (val === 'open') {
    toneClass = 'badge--critical';
  }

  return <span className={`chip ${toneClass}`}>{val}</span>;
};

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
  const prevStatesRef = useRef<Map<string, string>>(new Map());

  // Detect transitions to verified or protected and trigger toast
  useEffect(() => {
    const prevMap = prevStatesRef.current;
    if (prevMap.size > 0) {
      for (const f of findings) {
        const prev = prevMap.get(f.id);
        if (
          prev &&
          prev !== f.state &&
          (f.state === 'verified' || f.state === 'protected')
        ) {
          toast.success(`Finding ${f.id} marked as ${f.state}!`);
        }
      }
    }

    const nextMap = new Map<string, string>();
    for (const f of findings) {
      nextMap.set(f.id, f.state);
    }
    prevStatesRef.current = nextMap;
  }, [findings]);

  // Stable content signature prevents recreating rows array on every silent fetch
  const signature = useMemo(
    () => findings.map((f) => `${f.id}:${f.state}:${f.severity}:${f.title}`).join('|'),
    [findings],
  );
  const rows = useMemo(() => toFindingRows(findings), [findings, signature]);

  const onRowClicked = (event: RowClickedEvent<FindingRow>) => {
    if (!event.data) return;
    navigate(`/runs/${runId}/findings/${event.data.id}`);
  };

  return (
    <div data-testid="findings-grid" className="findings-grid-wrapper" style={{ width: '100%' }}>
      <AgGridReact<FindingRow>
        theme={gridTheme}
        domLayout="autoHeight"
        rowStyle={{ cursor: 'pointer' }}
        overlayNoRowsTemplate="<span>All invariants passed</span>"
        rowData={rows}
        getRowId={(p) => p.data.id}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true }}
        rowClassRules={{
          'finding-row--flash-green': (params) =>
            params.data?.state === 'verified' || params.data?.state === 'protected',
        }}
        onRowClicked={onRowClicked}
      />
    </div>
  );
}
