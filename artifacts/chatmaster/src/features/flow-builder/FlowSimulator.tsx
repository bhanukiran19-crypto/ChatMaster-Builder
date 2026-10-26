import { useState, type FormEvent } from 'react';
import { Check, CircleAlert, Play, RotateCcw, Send, Square } from 'lucide-react';
import {
  useSendSimulationInput,
  useStartFlowSimulation,
} from '@workspace/api-client-react';
import type {
  Flow,
  FlowExecution,
  SimulationStartInputTriggerType,
} from '@workspace/api-client-react';

type FlowSimulatorProps = {
  flow: Flow;
  onSaveDraft(): Promise<Flow>;
};

const triggerLabels: Record<SimulationStartInputTriggerType, string> = {
  conversation_start: 'Conversation starts',
  keyword: 'Keyword received',
  incoming_message: 'Incoming message',
};

export function FlowSimulator({ flow, onSaveDraft }: FlowSimulatorProps) {
  const [simulation, setSimulation] = useState<FlowExecution | null>(null);
  const [triggerType, setTriggerType] = useState<SimulationStartInputTriggerType>(
    () => flow.graph.nodes.find((node) => node.type === 'trigger')?.data.triggerType ?? 'conversation_start',
  );
  const [initialMessage, setInitialMessage] = useState('');
  const [contextText, setContextText] = useState('{"contactFields":{}}');
  const [reply, setReply] = useState('');
  const [contextError, setContextError] = useState('');
  const start = useStartFlowSimulation();
  const sendInput = useSendSimulationInput();

  const startSimulation = async (event: FormEvent) => {
    event.preventDefault();
    setContextError('');

    let context: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(contextText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Enter a JSON object for the test context.');
      }
      context = parsed as Record<string, unknown>;
    } catch (error) {
      setContextError(error instanceof Error ? error.message : 'The test context must be valid JSON.');
      return;
    }

    try {
      await onSaveDraft();
      const result = await start.mutateAsync({
        flowId: flow.id,
        data: {
          triggerType,
          message: initialMessage.trim() || null,
          context,
        },
      });
      setSimulation(result);
      setReply('');
    } catch {
      // The mutation state below displays the API error without inventing a response.
    }
  };

  const continueSimulation = async (event: FormEvent) => {
    event.preventDefault();
    if (!simulation || !reply.trim()) return;
    try {
      const result = await sendInput.mutateAsync({
        simulationId: simulation.id,
        data: { message: reply.trim() },
      });
      setSimulation(result);
      setReply('');
    } catch {
      // The mutation state below displays the API error.
    }
  };

  const chooseButton = async (buttonId: string) => {
    if (!simulation) return;
    try {
      const result = await sendInput.mutateAsync({
        simulationId: simulation.id,
        data: { buttonId },
      });
      setSimulation(result);
      setReply('');
    } catch {
      // The mutation state below displays the API error.
    }
  };

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-[#dfe4d9] bg-[#fffefa]" data-testid="flow-simulator">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e9ebe2] px-4 py-3">
        <div>
          <h2 className="font-display text-[14px] font-semibold">Conversation simulator</h2>
          <p className="mt-0.5 text-[10px] text-[#829087]">Runs a saved draft against isolated test data. No messages are sent to customers.</p>
        </div>
        {simulation && (
          <button
            type="button"
            onClick={() => { setSimulation(null); setReply(''); }}
            data-testid="button-reset-simulation"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#dfe4d9] bg-white px-3 py-2 text-[10px] font-semibold text-[#53675c] hover:bg-[#f5f7f1]"
          >
            <RotateCcw size={13} /> New test
          </button>
        )}
      </div>

      {!simulation ? (
        <form onSubmit={(event) => void startSimulation(event)} className="grid gap-3 p-4 md:grid-cols-[1fr_1fr]">
          <label className="block text-[10px] font-bold text-[#586a60]">
            Start condition
            <select
              value={triggerType}
              onChange={(event) => setTriggerType(event.target.value as SimulationStartInputTriggerType)}
              data-testid="select-simulation-trigger"
              className="mt-1.5 w-full rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2.5 py-2 text-[11px] font-normal outline-none focus:border-[#4b8a72]"
            >
              {Object.entries(triggerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-[10px] font-bold text-[#586a60]">
            {triggerType === 'keyword' ? 'Incoming message (must match a configured keyword)' : 'Sample incoming message'}
            <input
              value={initialMessage}
              onChange={(event) => setInitialMessage(event.target.value)}
              maxLength={2000}
              placeholder={triggerType === 'keyword' ? 'For example: order status' : 'Optional'}
              data-testid="input-simulation-message"
              className="mt-1.5 w-full rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2.5 py-2 text-[11px] font-normal outline-none focus:border-[#4b8a72]"
            />
          </label>
          <label className="block text-[10px] font-bold text-[#586a60] md:col-span-2">
            Test contact context (JSON)
            <textarea
              value={contextText}
              onChange={(event) => setContextText(event.target.value)}
              rows={3}
              maxLength={25000}
              data-testid="input-simulation-context"
              className="mt-1.5 w-full resize-y rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2.5 py-2 font-mono text-[10px] outline-none focus:border-[#4b8a72]"
            />
            <span className="mt-1 block font-normal text-[#89958c]">Use contactFields and tags to test contact updates and condition branches.</span>
          </label>
          {contextError && <p role="alert" className="text-[10px] text-[#a5483e] md:col-span-2">{contextError}</p>}
          {(start.isError || start.data?.status === 'failed') && (
            <div role="alert" className="rounded-lg border border-[#efd2c9] bg-[#fff7f3] p-3 text-[10px] leading-4 text-[#80463a] md:col-span-2">
              {start.data?.error || 'The simulation could not start. Check the API connection and try again.'}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 md:col-span-2">
            <span className="text-[9px] text-[#89958c]">The current draft is saved before the test starts.</span>
            <button
              type="submit"
              disabled={start.isPending}
              data-testid="button-start-simulation"
              className="inline-flex items-center gap-2 rounded-lg bg-[#1f6653] px-3.5 py-2.5 text-[10px] font-bold text-white hover:bg-[#174e40] disabled:opacity-60"
            >
              <Play size={13} /> {start.isPending ? 'Starting…' : 'Start test'}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid min-h-[280px] xl:grid-cols-[1fr_300px]">
          <div className="border-b border-[#e9ebe2] p-4 xl:border-b-0 xl:border-r">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[.1em] text-[#829087]">
                {triggerLabels[triggerType]}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${simulation.status === 'failed' ? 'bg-[#fff0eb] text-[#a5483e]' : simulation.status === 'completed' ? 'bg-[#e9f3eb] text-[#34755e]' : 'bg-[#f5f1e3] text-[#87723e]'}`}>
                {simulation.status.replaceAll('_', ' ')}
              </span>
            </div>
            <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-lg bg-[#f7f7f1] p-3" data-testid="simulation-message-list">
              {initialMessage.trim() && <div className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-[#e9f1e8] px-3 py-2 text-[11px] leading-5 text-[#365445]">{initialMessage}</div>}
              {simulation.messages.map((message, index) => (
                <article key={`${message.nodeId}-${index}`} className="max-w-[88%] rounded-xl rounded-bl-sm border border-[#e2e6dc] bg-[#fffefa] px-3 py-2.5 shadow-sm">
                  <p className="whitespace-pre-wrap text-[11px] leading-5 text-[#354b40]">{message.text}</p>
                  {message.buttons.length > 0 && simulation.status === 'awaiting_input' && index === simulation.messages.length - 1 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.buttons.map((button, buttonIndex) => (
                        <button
                          type="button"
                          key={button.id ?? `${button.label}-${buttonIndex}`}
                          disabled={sendInput.isPending}
                          onClick={() => void chooseButton(button.id ?? button.label)}
                          data-testid={`button-simulation-choice-${buttonIndex}`}
                          className="rounded-md border border-[#d9e2d7] bg-[#f9fbf6] px-2.5 py-1.5 text-[10px] font-semibold text-[#35745b] hover:bg-[#edf4eb] disabled:opacity-60"
                        >
                          {button.label}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
              {simulation.messages.length === 0 && simulation.status === 'awaiting_input' && (
                <p className="text-[10px] text-[#829087]">No message has been sent yet. Check that the matching trigger connects to a message step.</p>
              )}
              {simulation.error && (
                <div role="alert" className="flex gap-2 rounded-lg border border-[#efd2c9] bg-[#fff7f3] p-3 text-[10px] leading-4 text-[#80463a]">
                  <CircleAlert size={14} className="mt-0.5 shrink-0" /> {simulation.error}
                </div>
              )}
            </div>
            {sendInput.isError && <p role="alert" className="mt-2 text-[10px] text-[#a5483e]">The reply could not be sent to the simulator. Try again.</p>}
            {simulation.status === 'awaiting_input' && (
              <form onSubmit={(event) => void continueSimulation(event)} className="mt-3 flex gap-2">
                <input
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  maxLength={2000}
                  placeholder="Type a visitor reply…"
                  aria-label="Visitor reply"
                  data-testid="input-simulation-reply"
                  className="min-w-0 flex-1 rounded-lg border border-[#dfe2d7] bg-white px-3 py-2 text-[11px] outline-none focus:border-[#4b8a72]"
                />
                <button
                  type="submit"
                  disabled={!reply.trim() || sendInput.isPending}
                  aria-label="Send visitor reply"
                  data-testid="button-send-simulation-reply"
                  className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#1f6653] text-white hover:bg-[#174e40] disabled:opacity-50"
                >
                  {sendInput.isPending ? <Square size={12} /> : <Send size={13} />}
                </button>
              </form>
            )}
            {simulation.status === 'waiting_for_agent' && (
              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-[#806d45]"><Check size={13} /> This flow paused at a handoff. No real message was sent.</p>
            )}
          </div>
          <aside className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-bold uppercase tracking-[.1em] text-[#6e7d72]">Execution trace</h3>
              <span className="font-mono text-[9px] text-[#8c9990]">{simulation.stepsExecuted}/100 steps</span>
            </div>
            {simulation.context && Object.keys(simulation.context).length > 0 && (
              <div className="mt-3 rounded-lg border border-[#e7e9e0] bg-[#fbfaf6] p-2.5">
                <div className="mb-1 text-[9px] font-bold uppercase tracking-[.08em] text-[#8a968c]">Test contact state</div>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[9px] leading-4 text-[#627267]">{JSON.stringify(simulation.context, null, 2)}</pre>
              </div>
            )}
            <ol className="mt-3 max-h-[390px] space-y-2 overflow-y-auto">
              {simulation.trace.map((entry, index) => (
                <li key={`${entry.nodeId}-${index}`} className="rounded-lg border border-[#e7e9e0] bg-[#fbfaf6] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[9px] font-bold text-[#52675b]">{entry.nodeType.replaceAll('_', ' ')}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold ${entry.status === 'failed' ? 'bg-[#fff0eb] text-[#a5483e]' : 'bg-[#edf3eb] text-[#537963]'}`}>{entry.status.replaceAll('_', ' ')}</span>
                  </div>
                  <p className="mt-1 text-[9px] leading-4 text-[#78867d]">{entry.message}</p>
                  {Object.keys(entry.details).length > 0 && (
                    <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[8px] leading-3 text-[#909a91]">{JSON.stringify(entry.details)}</pre>
                  )}
                </li>
              ))}
              {simulation.trace.length === 0 && <li className="text-[9px] text-[#89958c]">No steps have run yet.</li>}
            </ol>
          </aside>
        </div>
      )}
    </section>
  );
}
