import { useEffect, useMemo, useState } from 'react';
import type { FirewallDecision, Finding, PolicyResponse } from '@payclinic/contracts';
import { useProtect, type ProtectStage } from '../api/useProtect';
import { api, type ApiClient } from '../api/client';
import type { RunEventSourceCtor } from '../api/useRunEvents';
import { DecisionLog } from '../components/DecisionLog';
import { PolicyView } from '../components/PolicyView';
import { ProtectButton } from '../components/ProtectButton';

export interface AgentRunSectionProps {
  runId: string;
  findings: Finding[];
  /** Reloads the run detail so protected findings appear while the flow runs. */
  reload?: () => void;
  client?: Partial<Pick<ApiClient, 'protect' | 'getPolicy' | 'getDecisions'>>;
  eventSourceCtor?: RunEventSourceCtor;
}

const STAGES: readonly { key: Exclude<ProtectStage, 'idle' | 'done' | 'failed'>; label: string }[] =
  [
    { key: 'generating', label: 'Generating policy' },
    { key: 'rerunning', label: 'Re-running the attack' },
    { key: 'verifying', label: 'Verifying' },
  ];

/** The agent-run section: Protect flow, policy view and the decision log. */
export function AgentRunSection({
  runId,
  findings,
  reload,
  client,
  eventSourceCtor,
}: AgentRunSectionProps) {
  const protectFn = client?.protect ?? api.protect;
  const getPolicyFn = client?.getPolicy ?? api.getPolicy;
  const getDecisionsFn = client?.getDecisions ?? api.getDecisions;
  const protectClient = useMemo(() => ({ protect: protectFn }), [protectFn]);

  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [initialDecisions, setInitialDecisions] = useState<FirewallDecision[]>([]);

  useEffect(() => {
    let active = true;
    getPolicyFn(runId).then(
      (result) => {
        if (active) setPolicy(result);
      },
      () => undefined,
    );
    getDecisionsFn(runId).then(
      (result) => {
        if (active) setInitialDecisions(result);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [runId, getPolicyFn, getDecisionsFn]);

  const {
    stage,
    message,
    decisions: liveDecisions,
    start,
  } = useProtect(runId, {
    client: protectClient,
    eventSourceCtor,
  });

  const allProtected =
    findings.length > 0 && findings.every((finding) => finding.state === 'protected');
  const effective: ProtectStage = allProtected ? 'done' : stage;

  // While the flow runs, refresh the run so protected findings show up; the
  // poll stops itself once everything is protected.
  const running =
    effective === 'generating' || effective === 'rerunning' || effective === 'verifying';
  useEffect(() => {
    if (!reload || !running || allProtected) return;
    const timer = setInterval(reload, 2000);
    const stop = setTimeout(() => clearInterval(timer), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [reload, running, allProtected]);

  const merged = useMemo(() => {
    const byId = new Map<string, FirewallDecision>();
    for (const decision of [...initialDecisions, ...liveDecisions]) byId.set(decision.id, decision);
    return [...byId.values()];
  }, [initialDecisions, liveDecisions]);

  const currentIndex = STAGES.findIndex((item) => item.key === effective);

  return (
    <section className="agent-run" data-testid="agent-run-section">
      <h2>Agent attack</h2>
      {!allProtected && <ProtectButton stage={stage} message={message} onStart={start} />}
      {(stage !== 'idle' || allProtected) && (
        <ol className="protect-stepper" data-testid="protect-stepper">
          {STAGES.map((item, index) => (
            <li
              key={item.key}
              data-testid={`stage-${item.key}`}
              data-active={effective === item.key ? 'true' : 'false'}
              data-complete={
                (currentIndex > index || effective === 'done') && effective !== 'failed'
                  ? 'true'
                  : 'false'
              }
            >
              {item.label}
            </li>
          ))}
        </ol>
      )}
      <PolicyView policy={policy?.policy ?? null} yaml={policy?.yaml ?? null} />
      <DecisionLog decisions={merged} />
    </section>
  );
}
