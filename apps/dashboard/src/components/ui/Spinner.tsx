export interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = 'Loading...' }: SpinnerProps) {
  return (
    <span className="spinner" role="status">
      <span className="spinner__dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
