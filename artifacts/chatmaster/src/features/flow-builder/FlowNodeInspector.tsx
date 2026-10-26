import { Copy, Trash2, X } from 'lucide-react';
import type {
  FlowNode,
  FlowNodeData,
  FlowNodeDataConditionOperator,
} from '@workspace/api-client-react';

type FlowNodeInspectorProps = {
  selected: FlowNode | null;
  description: string;
  onDescriptionChange(value: string): void;
  onPatchData(patch: Partial<FlowNodeData>): void;
  onDelete(): void;
  onDuplicate(): void;
};

const operators: Exclude<FlowNodeDataConditionOperator, null>[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'exists',
  'not_exists',
];

const inputClass =
  'mt-1.5 w-full rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2.5 py-2 text-[11px] font-normal outline-none transition focus:border-[#4b8a72] focus:ring-2 focus:ring-[#4b8a72]/15';

function makeButtonId() {
  return globalThis.crypto?.randomUUID?.() ?? `button-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function FlowNodeInspector({
  selected,
  description,
  onDescriptionChange,
  onPatchData,
  onDelete,
  onDuplicate,
}: FlowNodeInspectorProps) {
  if (!selected) {
    return (
      <aside className="border-t border-[#e8e9df] bg-[#fffefa] xl:border-l xl:border-t-0">
        <div className="p-5">
          <div className="grid size-9 place-items-center rounded-lg bg-[#edf2e9] text-[#32745d]">
            <span className="text-[18px]">i</span>
          </div>
          <h3 className="font-display mt-4 text-[15px] font-semibold">Flow details</h3>
          <p className="mt-2 text-[11px] leading-5 text-[#7f8c84]">
            Select a step on the canvas to configure it. Click and drag between connection ports to wire steps together.
          </p>
          <label className="mt-5 block text-[10px] font-bold text-[#586a60]">
            Flow description
            <textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="What does this flow help with?"
              data-testid="input-flow-description"
              className={`${inputClass} resize-none`}
            />
          </label>
        </div>
      </aside>
    );
  }

  const patch = (updates: Partial<FlowNodeData>) => onPatchData(updates);

  return (
    <aside className="border-t border-[#e8e9df] bg-[#fffefa] xl:border-l xl:border-t-0">
      <div className="max-h-[820px] overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[.13em] text-[#34755e]">
              {selected.type.replaceAll('_', ' ')} step
            </div>
            <h3 className="font-display mt-1 text-[16px] font-semibold">Step details</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="button-duplicate-node"
              aria-label="Duplicate selected step"
              onClick={onDuplicate}
              className="rounded-md p-2 text-[#75857a] hover:bg-[#edf3eb] hover:text-[#32745d]"
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              data-testid="button-remove-node"
              aria-label="Delete selected step"
              onClick={onDelete}
              className="rounded-md p-2 text-[#9b837c] hover:bg-[#fff0eb] hover:text-[#b84c41]"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        <label className="mt-5 block text-[10px] font-bold text-[#586a60]">
          Step name
          <input
            value={selected.data.label}
            onChange={(event) => patch({ label: event.target.value })}
            maxLength={120}
            data-testid="input-node-label"
            className={inputClass}
          />
        </label>

        {selected.type === 'trigger' && (
          <>
            <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
              Start when
              <select
                value={selected.data.triggerType ?? 'conversation_start'}
                onChange={(event) => patch({ triggerType: event.target.value as FlowNodeData['triggerType'] })}
                data-testid="select-trigger-type"
                className={inputClass}
              >
                <option value="conversation_start">A conversation starts</option>
                <option value="keyword">A keyword is received</option>
                <option value="incoming_message">Any incoming message arrives</option>
              </select>
            </label>
            {selected.data.triggerType === 'keyword' && (
              <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
                Keywords
                <input
                  value={(selected.data.keywords ?? []).join(', ')}
                  onChange={(event) => patch({ keywords: event.target.value.split(',').map((word) => word.trim()).filter(Boolean) })}
                  maxLength={2000}
                  placeholder="order, refund, delivery"
                  data-testid="input-trigger-keywords"
                  className={inputClass}
                />
                <span className="mt-1 block text-[9px] font-normal text-[#88948c]">Separate keywords with commas.</span>
              </label>
            )}
          </>
        )}

        {selected.type === 'message' && (
          <>
            <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
              Message format
              <select
                value={selected.data.messageType ?? 'text'}
                onChange={(event) => patch({ messageType: event.target.value as FlowNodeData['messageType'] })}
                data-testid="select-message-type"
                className={inputClass}
              >
                <option value="text">Text message</option>
                <option value="buttons">Message with reply buttons</option>
              </select>
            </label>
            <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
              Message text
              <textarea
                value={selected.data.text ?? ''}
                onChange={(event) => patch({ text: event.target.value })}
                maxLength={2000}
                rows={5}
                data-testid="input-node-message"
                placeholder="Write the message your customer will see."
                className={`${inputClass} resize-y leading-5`}
              />
            </label>
            {selected.data.messageType === 'buttons' && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[#586a60]">Reply buttons</span>
                  <span className="text-[9px] text-[#99a39a]">{selected.data.buttons?.length ?? 0}/5</span>
                </div>
                {(selected.data.buttons ?? []).map((button, index) => (
                  <div key={`${selected.id}-button-${index}`} className="mt-2 flex gap-1">
                    <input
                      value={button.label}
                      maxLength={80}
                      aria-label={`Reply button ${index + 1} label`}
                      onChange={(event) => {
                        const buttons = [...(selected.data.buttons ?? [])];
                        buttons[index] = { ...buttons[index], label: event.target.value };
                        patch({ buttons });
                      }}
                      data-testid={`input-node-button-${index}`}
                      className={`${inputClass} mt-0 min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      aria-label={`Remove reply button ${index + 1}`}
                      onClick={() => patch({ buttons: (selected.data.buttons ?? []).filter((_, buttonIndex) => buttonIndex !== index) })}
                      className="mt-0.5 rounded-md p-2 text-[#99a39a] hover:bg-[#fff0eb] hover:text-[#b84c41]"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {(selected.data.buttons?.length ?? 0) < 5 && (
                  <button
                    type="button"
                    data-testid="button-add-reply"
                    onClick={() => patch({
                      buttons: [...(selected.data.buttons ?? []), {
                        id: makeButtonId(),
                        label: `Option ${(selected.data.buttons?.length ?? 0) + 1}`,
                        targetId: null,
                      }],
                    })}
                    className="mt-2 text-[10px] font-bold text-[#32745d] hover:underline"
                  >
                    Add reply button
                  </button>
                )}
                <p className="mt-2 text-[9px] leading-4 text-[#89958c]">
                  Connect each button’s port to the step it should open.
                </p>
              </div>
            )}
          </>
        )}

        {selected.type === 'condition' && (
          <div className="mt-4 space-y-3">
            <label className="block text-[10px] font-bold text-[#586a60]">
              Contact field
              <input
                value={selected.data.conditionField ?? ''}
                onChange={(event) => patch({ conditionField: event.target.value })}
                maxLength={160}
                placeholder="contactFields.plan"
                data-testid="input-condition-field"
                className={inputClass}
              />
            </label>
            <label className="block text-[10px] font-bold text-[#586a60]">
              Comparison
              <select
                value={selected.data.conditionOperator ?? ''}
                onChange={(event) => patch({ conditionOperator: (event.target.value || null) as FlowNodeDataConditionOperator })}
                data-testid="select-condition-operator"
                className={inputClass}
              >
                <option value="">Choose a comparison</option>
                {operators.map((operator) => (
                  <option key={operator} value={operator}>{operator.replaceAll('_', ' ')}</option>
                ))}
              </select>
            </label>
            {!['exists', 'not_exists'].includes(selected.data.conditionOperator ?? '') && (
              <label className="block text-[10px] font-bold text-[#586a60]">
                Value
                <input
                  value={selected.data.conditionValue ?? ''}
                  onChange={(event) => patch({ conditionValue: event.target.value })}
                  maxLength={500}
                  placeholder="Value to compare"
                  data-testid="input-condition-value"
                  className={inputClass}
                />
              </label>
            )}
            <p className="text-[9px] leading-4 text-[#89958c]">Connect both the true and false output ports.</p>
          </div>
        )}

        {selected.type === 'add_tag' && (
          <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
            Tag name
            <input
              value={selected.data.tagName ?? ''}
              onChange={(event) => patch({ tagName: event.target.value })}
              maxLength={80}
              placeholder="Interested in pricing"
              data-testid="input-tag-name"
              className={inputClass}
            />
          </label>
        )}

        {selected.type === 'update_field' && (
          <>
            <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
              Contact field
              <input
                value={selected.data.fieldName ?? ''}
                onChange={(event) => patch({ fieldName: event.target.value })}
                maxLength={120}
                placeholder="plan"
                data-testid="input-contact-field-name"
                className={inputClass}
              />
            </label>
            <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
              Value
              <input
                value={selected.data.fieldValue ?? ''}
                onChange={(event) => patch({ fieldValue: event.target.value })}
                maxLength={1000}
                placeholder="premium"
                data-testid="input-contact-field-value"
                className={inputClass}
              />
            </label>
          </>
        )}

        {selected.type === 'delay' && (
          <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
            Wait duration (seconds)
            <input
              type="number"
              min={0}
              max={86400}
              value={selected.data.delaySeconds ?? ''}
              onChange={(event) => patch({ delaySeconds: event.target.value === '' ? null : Number(event.target.value) })}
              data-testid="input-delay-seconds"
              className={inputClass}
            />
            <span className="mt-1 block text-[9px] font-normal text-[#88948c]">In simulations, the wait is recorded but not performed in real time.</span>
          </label>
        )}

        {selected.type === 'ai_response' && (
          <>
            <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
              AI instructions
              <textarea
                value={selected.data.aiPrompt ?? ''}
                onChange={(event) => patch({ aiPrompt: event.target.value })}
                maxLength={2000}
                rows={5}
                placeholder="Describe how the response should be written."
                data-testid="input-ai-prompt"
                className={`${inputClass} resize-y leading-5`}
              />
            </label>
            <p className="mt-2 rounded-lg border border-[#ecd9bd] bg-[#fff8e9] p-2.5 text-[9px] leading-4 text-[#816c49]">
              AI provider setup is not connected yet. Validation will block publishing this step, and simulations will report that no provider is configured.
            </p>
          </>
        )}

        {selected.type === 'human_handoff' && (
          <label className="mt-4 block text-[10px] font-bold text-[#586a60]">
            Handoff note
            <textarea
              value={selected.data.handoffNote ?? ''}
              onChange={(event) => patch({ handoffNote: event.target.value })}
              maxLength={1000}
              rows={3}
              placeholder="What should the teammate know?"
              data-testid="input-handoff-note"
              className={`${inputClass} resize-y`}
            />
          </label>
        )}

        {selected.type === 'end' && (
          <p className="mt-4 rounded-lg border border-[#e3e9df] bg-[#f5f8f1] p-3 text-[10px] leading-5 text-[#718078]">
            This step marks the conversation path as complete.
          </p>
        )}

        <div className="my-5 border-t border-[#ecece3]" />
        <label className="block text-[10px] font-bold text-[#586a60]">
          Flow description
          <textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="What does this flow help with?"
            data-testid="input-flow-description"
            className={`${inputClass} resize-none`}
          />
        </label>
      </div>
    </aside>
  );
}
