import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../test-setup';
import { UnifiedDiff } from './UnifiedDiff';

const diff =
  '--- a/x.ts\n' +
  '+++ b/x.ts\n' +
  '@@ -1 +1 @@\n' +
  '-<img src="x" onerror="alert(1)">\n' +
  '+<strong>safe</strong>\n' +
  ' keep\n';

describe('UnifiedDiff', () => {
  it('renders add, del, hunk and meta line classes (P2-C02)', () => {
    const { container } = render(<UnifiedDiff diff={diff} />);

    expect(container.querySelectorAll('.diff__line--meta')).toHaveLength(2);
    expect(container.querySelectorAll('.diff__line--hunk')).toHaveLength(1);
    expect(container.querySelectorAll('.diff__line--del')).toHaveLength(1);
    expect(container.querySelectorAll('.diff__line--add')).toHaveLength(1);
    expect(container.querySelectorAll('.diff__line--ctx')).toHaveLength(1);
  });

  it('renders diff text as escaped text, never as HTML (P2-C02)', () => {
    const { container } = render(<UnifiedDiff diff={diff} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect(screen.queryByText('<img src="x" onerror="alert(1)">')).not.toBeInTheDocument();
    expect(screen.getByText('-<img src="x" onerror="alert(1)">')).toBeInTheDocument();
    expect(screen.getByText('+<strong>safe</strong>')).toBeInTheDocument();
  });
});
