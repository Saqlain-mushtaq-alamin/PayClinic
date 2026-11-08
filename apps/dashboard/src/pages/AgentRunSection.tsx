import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { FirewallDecision, Finding, PolicyResponse } from '@payclinic/contracts';
import { useProtect, type ProtectStage } from '../api/useProtect';
import { api, type ApiClient } from '../api/client';
import type { RunEventSourceCtor } from '../api/useRunEvents';
import { DecisionLog } from '../components/DecisionLog';
import { PolicyView } from '../components/PolicyView';
import { ProtectButton } from '../components/ProtectButton';
import { Card } from '../components/ui/Card';

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

  const toastedRef = useRef<ProtectStage | null>(null);
  useEffect(() => {
    if (stage === 'done' && toastedRef.current !== 'done') {
      toastedRef.current = 'done';
      toast.success('Agent protected: firewall policy generated & verified');
    } else if (stage === 'failed' && toastedRef.current !== 'failed') {
      toastedRef.current = 'failed';
      toast.error(message ?? 'Protect flow failed');
    } else if (stage === 'idle') {
      toastedRef.current = null;
    }
  }, [stage, message]);

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

  // Stepper progress percent for the connecting bar
  const progressPercent =
    effective === 'done'
      ? 100
      : currentIndex >= 0
        ? ((currentIndex + 0.5) / STAGES.length) * 100
        : 0;

  return (
    <section className="agent-run" data-testid="agent-run-section">
      <Card className="agent-run__card">
        <div className="agent-run__header">
          <div className="agent-run__title-group">
            <ShieldCheck size={20} className="text-accent" />
            <h2 className="agent-run__title">Agent spending firewall</h2>
          </div>
          {!allProtected && <ProtectButton stage={stage} message={message} onStart={start} />}
        </div>

        {(stage !== 'idle' || allProtected) && (
          <div className="stepper-horizontal-container">
            <div className="stepper-track-bar">
              <div className="stepper-track-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <ol className="protect-stepper" data-testid="protect-stepper">
              {STAGES.map((item, index) => {
                const isComplete =
                  (currentIndex > index || effective === 'done') && effective !== 'failed';
                const isActive = effective === item.key;

                return (
                  <li
                    key={item.key}
                    data-testid={`stage-${item.key}`}
                    data-active={isActive ? 'true' : 'false'}
                    data-complete={isComplete ? 'true' : 'false'}
                    className={`stepper-step ${
                      isComplete
                        ? 'stepper-step--complete'
                        : isActive
                          ? 'stepper-step--active'
                          : 'stepper-step--pending'
                    }`}
                  >
                    <div className="stepper-step__circle">
                      {isComplete ? (
                        <Check size={14} className="stepper-step__check" />
                      ) : isActive ? (
                        <Loader2 size={14} className="stepper-step__spinner spinner" />
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </div>
                    <span className="stepper-step__label">{item.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <PolicyView policy={policy?.policy ?? null} yaml={policy?.yaml ?? null} />
        <DecisionLog decisions={merged} />
      </Card>
    </section>
  );
}
