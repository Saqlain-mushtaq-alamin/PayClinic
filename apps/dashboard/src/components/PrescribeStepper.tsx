import type { PrescribeStage } from '../api/usePrescribe';

const STAGES: readonly PrescribeStage[] = ['explaining', 'patching', 'verifying', 'done'];

export interface PrescribeStepperProps {
  stage: PrescribeStage;
}

/** Shows the four prescribe stages with the current one active. */
export function PrescribeStepper({ stage }: PrescribeStepperProps) {
  const currentIndex = STAGES.indexOf(stage);

  return (
    <ol className="prescribe-stepper" data-testid="prescribe-stepper">
      {STAGES.map((name, index) => (
        <li
          key={name}
          data-testid={`stage-${name}`}
          data-active={index === currentIndex ? 'true' : 'false'}
          data-complete={currentIndex > index || stage === 'done' ? 'true' : 'false'}
        >
          {name}
        </li>
      ))}
    </ol>
  );
}
