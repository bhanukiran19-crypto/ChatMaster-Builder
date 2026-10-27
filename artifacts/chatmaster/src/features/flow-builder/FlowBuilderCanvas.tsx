import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge, EdgeChange, Node, NodeChange, NodeProps } from '@xyflow/react';
import {
  ArrowDownToLine,
  Clock3,
  GitBranch,
  Headset,
  MessageSquareText,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Workflow,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FlowEdge, FlowGraph, FlowNode } from '@workspace/api-client-react';

type StepType = FlowNode['type'];

type StepMeta = {
  label: string;
  hint: string;
  icon: LucideIcon;
  color: string;
  tint: string;
};

const stepTypes: StepType[] = [
  'trigger',
  'message',
  'condition',
  'add_tag',
  'update_field',
  'delay',
  'ai_response',
  'human_handoff',
  'end',
];

const stepMeta: Record<StepType, StepMeta> = {
  trigger: { label: 'Trigger', hint: 'Start a conversation', icon: Zap, color: '#26725b', tint: '#e9f3eb' },
  message: { label: 'Message', hint: 'Send a reply', icon: MessageSquareText, color: '#bd6847', tint: '#fbefe7' },
  condition: { label: 'Condition', hint: 'Branch by a rule', icon: GitBranch, color: '#827443', tint: '#f4f1df' },
  add_tag: { label: 'Add tag', hint: 'Label the contact', icon: Tag, color: '#6e6a9a', tint: '#f0eef8' },
  update_field: { label: 'Update field', hint: 'Change contact data', icon: SlidersHorizontal, color: '#387c89', tint: '#e8f3f3' },
  delay: { label: 'Delay', hint: 'Wait before continuing', icon: Clock3, color: '#a16b34', tint: '#f8efe1' },
  ai_response: { label: 'AI response', hint: 'Draft an AI reply', icon: Sparkles, color: '#91605f', tint: '#f7eceb' },
  human_handoff: { label: 'Human handoff', hint: 'Route to a teammate', icon: Headset, color: '#456e86', tint: '#eaf1f5' },
  end: { label: 'End', hint: 'Close the conversation', icon: X, color: '#69776f', tint: '#edf0ec' },
};

type CanvasNodeData = {
  backend: FlowNode;
  sourceHandles: { id: string; label: string; connectable: boolean }[];
  targetHandles: string[];
};

type CanvasNode = Node<CanvasNodeData, 'flowStep'>;
type CanvasEdge = Edge<{ backend: FlowEdge }>;

type FlowBuilderCanvasProps = {
  graph: FlowGraph;
  selectedId: string | null;
  onGraphChange(graph: FlowGraph): void;
  onSelectedIdChange(id: string | null): void;
  onAddNode(type: FlowNode['type'], position?: { x: number; y: number }): void;
};

function makeEdgeId() {
  return globalThis.crypto?.randomUUID?.() ?? `edge-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function previewFor(node: FlowNode) {
  const data = node.data;
  switch (node.type) {
    case 'trigger':
      return data.keywords?.length ? `Keywords: ${data.keywords.join(', ')}` : 'Starts when a conversation begins';
    case 'message':
      return data.text || 'Add the message your customer will see';
    case 'condition':
      return data.condition || [data.conditionField, data.conditionOperator, data.conditionValue].filter(Boolean).join(' ') || 'Choose what to check';
    case 'add_tag':
      return data.tagName ? `Apply “${data.tagName}”` : 'Choose a contact tag';
    case 'update_field':
      return data.fieldName ? `${data.fieldName}: ${data.fieldValue || 'Set a value'}` : 'Choose a field to update';
    case 'delay':
      return data.delaySeconds != null ? `Wait ${data.delaySeconds} seconds` : 'Set a wait duration';
    case 'ai_response':
      return data.aiPrompt || 'Add guidance for the AI response';
    case 'human_handoff':
      return data.handoffNote || 'Route this conversation to a teammate';
    case 'end':
      return 'Conversation reaches its end';
  }
}

function canonicalSourceHandles(node: FlowNode) {
  if (node.type === 'condition') {
    return [
      { id: 'true', label: 'True', connectable: true },
      { id: 'false', label: 'False', connectable: true },
    ];
  }
  if (node.type === 'message' && node.data.buttons?.length) {
    return node.data.buttons.map((button, index) => ({
      id: `button:${button.id || index}`,
      label: button.label,
      connectable: true,
    }));
  }
  if (node.type === 'end') return [];
  return [{ id: 'next', label: 'Next', connectable: true }];
}

function FlowStepNode({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.backend;
  const meta = stepMeta[node.type];
  const Icon = meta.icon;

  const handleStyle = (index: number, count: number): CSSProperties => ({
    top: `${((index + 1) / (count + 1)) * 100}%`,
    width: 10,
    height: 10,
    border: '2px solid #fffefa',
    background: meta.color,
  });

  return (
    <article
      aria-label={`${meta.label} step: ${node.data.label}`}
      data-testid={`node-${node.id}`}
      className={`group relative w-[224px] rounded-xl border bg-[#fffefa] transition-shadow ${selected ? 'shadow-[0_0_0_2px_rgba(38,114,91,.2),0_12px_28px_rgba(35,57,48,.13)]' : 'shadow-[0_8px_22px_rgba(35,57,48,.10)]'}`}
      style={{ borderColor: selected ? '#6aa18a' : '#dfe5dc' }}
    >
      {data.targetHandles.map((handleId, index) => (
        <Handle
          key={`target-${handleId}`}
          type="target"
          id={handleId}
          position={Position.Left}
          style={handleStyle(index, data.targetHandles.length)}
          aria-label={`Connect to ${meta.label} input`}
        />
      ))}
      <div className="flex items-center gap-2 border-b border-[#eef0e9] px-3.5 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: meta.tint, color: meta.color }}>
          <Icon size={14} strokeWidth={2.1} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[.12em]" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className="font-mono text-[9px] text-[#a0aaa1]">{node.id.slice(0, 6)}</span>
      </div>
      <div className="px-3.5 pb-3.5 pt-3">
        <h3 className="truncate text-[13px] font-semibold leading-5 text-[#263b34]">{node.data.label || meta.label}</h3>
        <p className="mt-1 line-clamp-2 min-h-8 break-words text-[10px] leading-4 text-[#78867e]">{previewFor(node)}</p>
        {node.type === 'message' && node.data.buttons && node.data.buttons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {node.data.buttons.slice(0, 3).map((button, index) => (
              <span key={button.id ?? `${button.label}-${index}`} className="max-w-full truncate rounded-md border border-[#e6e9e1] bg-[#fafaf6] px-2 py-1 text-[9px] text-[#68776e]">
                {button.label}
              </span>
            ))}
            {node.data.buttons.length > 3 && <span className="px-1 py-1 text-[9px] text-[#89948c]">+{node.data.buttons.length - 3}</span>}
          </div>
        )}
      </div>
      {data.sourceHandles.map((handle) => (
        <div key={`source-row-${handle.id}`} className="relative flex min-h-[25px] items-center justify-end border-t border-[#eef0e9] px-3">
          <span
            aria-hidden="true"
            title={handle.label}
            className={`mr-1 max-w-[172px] truncate rounded border px-2 py-1 text-[9px] font-semibold leading-3 ${handle.connectable ? 'border-[#dfe7dc] bg-[#f8faf6] text-[#52695a]' : 'border-[#e9e9e2] bg-[#f6f6f0] text-[#8c938a]'}`}
          >
            {handle.label}
          </span>
          <Handle
            type="source"
            id={handle.id}
            position={Position.Right}
            style={{ top: '50%', width: 10, height: 10, border: '2px solid #fffefa', background: meta.color }}
            isConnectable={handle.connectable}
            aria-label={`Connect from ${meta.label} output: ${handle.label}`}
          />
        </div>
      ))}
    </article>
  );
}

const nodeTypes = { flowStep: FlowStepNode };

function CanvasViewportControls() {
  const { fitView, zoomIn, zoomOut } = useReactFlow<CanvasNode, CanvasEdge>();
  return (
    <Panel position="bottom-right" className="!m-3">
      <div className="flex overflow-hidden rounded-lg border border-[#dce3da] bg-[#fffefa] shadow-[0_5px_16px_rgba(35,57,48,.1)]">
        <button type="button" onClick={() => zoomOut({ duration: 120 })} aria-label="Zoom out" data-testid="button-canvas-zoom-out" className="grid size-9 place-items-center text-[#52675c] transition-colors hover:bg-[#f1f5ef]">
          <ZoomOut size={15} aria-hidden="true" />
        </button>
        <span className="my-2 w-px bg-[#e6eae3]" />
        <button type="button" onClick={() => zoomIn({ duration: 120 })} aria-label="Zoom in" data-testid="button-canvas-zoom-in" className="grid size-9 place-items-center text-[#52675c] transition-colors hover:bg-[#f1f5ef]">
          <ZoomIn size={15} aria-hidden="true" />
        </button>
        <span className="my-2 w-px bg-[#e6eae3]" />
        <button type="button" onClick={() => void fitView({ padding: 0.24, duration: 300 })} aria-label="Fit flow to canvas" data-testid="button-canvas-fit-view" className="grid size-9 place-items-center text-[#52675c] transition-colors hover:bg-[#f1f5ef]">
          <ArrowDownToLine size={15} aria-hidden="true" />
        </button>
      </div>
    </Panel>
  );
}

function FlowBuilderCanvasContent({
  graph,
  selectedId,
  onGraphChange,
  onSelectedIdChange,
  onAddNode,
}: FlowBuilderCanvasProps) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const { screenToFlowPosition } = useReactFlow<CanvasNode, CanvasEdge>();
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const commitGraph = (nextGraph: FlowGraph) => {
    graphRef.current = nextGraph;
    onGraphChange(nextGraph);
  };

  const nodes = useMemo<CanvasNode[]>(() => graph.nodes.map((node) => {
    const sourceHandles = canonicalSourceHandles(node);
    const canonicalIds = new Set(sourceHandles.map((handle) => handle.id));
    const existingHandleIds = graph.edges
      .filter((edge) => edge.source === node.id && edge.sourceHandle)
      .map((edge) => edge.sourceHandle as string);
    for (const handleId of existingHandleIds) {
      if (!canonicalIds.has(handleId)) {
        canonicalIds.add(handleId);
        sourceHandles.push({ id: handleId, label: `Existing: ${handleId}`, connectable: false });
      }
    }
    const targetHandles = Array.from(new Set([
      'in',
      ...graph.edges
        .filter((edge) => edge.target === node.id && edge.targetHandle)
        .map((edge) => edge.targetHandle as string),
    ]));

    return {
      id: node.id,
      type: 'flowStep',
      position: { x: node.position.x, y: node.position.y },
      data: { backend: node, sourceHandles, targetHandles },
      selected: selectedId === node.id,
      draggable: true,
      selectable: true,
    };
  }), [graph.nodes, graph.edges, selectedId]);

  const edges = useMemo<CanvasEdge[]>(() => graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: 'smoothstep',
    label: edge.label ?? undefined,
    data: { backend: edge },
    selected: edge.id === selectedEdgeId,
    deletable: true,
    style: { stroke: edge.id === selectedEdgeId ? '#26725b' : '#71927e', strokeWidth: edge.id === selectedEdgeId ? 2.5 : 1.8 },
    labelStyle: { fill: '#53685b', fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: '#fffefa', fillOpacity: 0.96 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
  })), [graph.edges, selectedEdgeId]);

  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const handleNodesChange = (changes: NodeChange<CanvasNode>[]) => {
    const currentGraph = graphRef.current;
    const removedIds = new Set<string>();
    for (const change of changes) {
      if (change.type === 'select') {
        if (change.selected) onSelectedIdChange(change.id);
        else if (selectedId === change.id) onSelectedIdChange(null);
      } else if (change.type === 'remove') {
        removedIds.add(change.id);
      }
    }

    const positionChanges = changes.filter((change): change is Extract<NodeChange<CanvasNode>, { type: 'position' }> =>
      change.type === 'position' && !!change.position,
    );
    if (removedIds.size > 0 || positionChanges.length > 0) {
      commitGraph({
        nodes: currentGraph.nodes
          .filter((node) => !removedIds.has(node.id))
          .map((node) => {
            const change = positionChanges.find((item) => item.id === node.id);
            return change?.position
              ? { ...node, position: { x: change.position.x, y: change.position.y } }
              : node;
          }),
        edges: currentGraph.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)),
      });
      if (selectedId && removedIds.has(selectedId)) onSelectedIdChange(null);
    }
  };

  const handleEdgesChange = (changes: EdgeChange<CanvasEdge>[]) => {
    const currentGraph = graphRef.current;
    const removeIds = new Set<string>();
    for (const change of changes) {
      if (change.type === 'select') {
        setSelectedEdgeId(change.selected ? change.id : (selectedEdgeId === change.id ? null : selectedEdgeId));
      } else if (change.type === 'remove') {
        removeIds.add(change.id);
      }
    }
    if (removeIds.size > 0) {
      commitGraph({ ...currentGraph, edges: currentGraph.edges.filter((edge) => !removeIds.has(edge.id)) });
      if (selectedEdgeId && removeIds.has(selectedEdgeId)) setSelectedEdgeId(null);
    }
  };

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const currentGraph = graphRef.current;
    const sourceNode = currentGraph.nodes.find((node) => node.id === connection.source);
    if (!sourceNode || !canonicalSourceHandles(sourceNode).some((handle) => handle.id === connection.sourceHandle)) return;
    const nextEdge: FlowEdge = {
      id: makeEdgeId(),
      source: connection.source,
      target: connection.target,
      label: null,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
    };
    commitGraph({ ...currentGraph, edges: [...currentGraph.edges, nextEdge] });
    setSelectedEdgeId(nextEdge.id);
    onSelectedIdChange(null);
  };

  const updateSelectedEdgeLabel = (label: string) => {
    if (!selectedEdge) return;
    const currentGraph = graphRef.current;
    commitGraph({
      ...currentGraph,
      edges: currentGraph.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, label: label || null } : edge),
    });
  };

  const deleteSelectedEdge = () => {
    if (!selectedEdge) return;
    const currentGraph = graphRef.current;
    commitGraph({ ...currentGraph, edges: currentGraph.edges.filter((edge) => edge.id !== selectedEdge.id) });
    setSelectedEdgeId(null);
  };

  const onNodeClick = (_event: MouseEvent, node: CanvasNode) => {
    onSelectedIdChange(node.id);
    setSelectedEdgeId(null);
  };

  const onEdgeClick = (_event: MouseEvent, edge: CanvasEdge) => {
    setSelectedEdgeId(edge.id);
    onSelectedIdChange(null);
  };

  const handlePaletteDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const droppedType = event.dataTransfer.getData('application/x-chatmaster-step') as StepType;
    if (!stepTypes.includes(droppedType)) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onAddNode(droppedType, { x: position.x, y: position.y });
  };

  const allowPaletteDrop = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('application/x-chatmaster-step')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  return (
    <section className="flow-builder-canvas overflow-hidden rounded-xl border border-[#dce2d8] bg-[#fffefa] text-[#263b34]" data-testid="flow-builder-canvas">
      <style>{`
        .flow-builder-canvas .react-flow__node { border-radius: 12px; }
        .flow-builder-canvas .react-flow__handle { transition: transform 140ms ease, background-color 140ms ease; }
        .flow-builder-canvas .react-flow__node:hover .react-flow__handle,
        .flow-builder-canvas .react-flow__handle.connecting,
        .flow-builder-canvas .react-flow__handle.valid { transform: scale(1.25); }
        .flow-builder-canvas .react-flow__edge-path { stroke-linecap: round; }
        .flow-builder-canvas .react-flow__minimap { border: 1px solid #dce3da; border-radius: 9px; overflow: hidden; }
      `}</style>

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8ebe3] bg-[#fffefa] px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e9f2e9] text-[#26725b]">
            <Workflow size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[14px] font-semibold tracking-[-.02em]">Conversation map</h2>
            <p data-testid="text-flow-canvas-count" className="mt-0.5 text-[10px] text-[#819087]">
              {graph.nodes.length} {graph.nodes.length === 1 ? 'step' : 'steps'} <span className="px-1 text-[#bdc6bc]">/</span> {graph.edges.length} {graph.edges.length === 1 ? 'connection' : 'connections'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#829087]">
          <span className="hidden sm:inline">Drag steps to arrange</span>
          <span aria-hidden="true" className="hidden size-1 rounded-full bg-[#b9c5b9] sm:block" />
          <span>Connect the ports to build a path</span>
        </div>
      </header>

      <div className="grid min-h-[690px] grid-cols-1 lg:grid-cols-[218px_minmax(0,1fr)]">
        <aside aria-label="Add a flow step" className="border-b border-[#e8ebe3] bg-[#f8f8f2] p-3.5 lg:border-b-0 lg:border-r lg:p-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <div>
              <h3 className="text-[11px] font-bold text-[#364b40]">Add a step</h3>
              <p className="mt-0.5 text-[9px] text-[#8a968e]">Choose or drag a building block</p>
            </div>
            <span className="rounded-md bg-[#edf1e9] px-1.5 py-1 font-mono text-[9px] text-[#78877c]">09</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            {stepTypes.map((type) => {
              const meta = stepMeta[type];
              const Icon = meta.icon;
              return (
                <button
                  type="button"
                  key={type}
                  onClick={() => onAddNode(type)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-chatmaster-step', type);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  aria-label={`Add ${meta.label} step`}
                  data-testid={`button-add-${type}`}
                  className="group flex min-w-[148px] shrink-0 items-center gap-2.5 rounded-lg border border-transparent bg-transparent px-2.5 py-2 text-left transition-colors hover:border-[#e1e7dd] hover:bg-[#fffefa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5c9b7f] lg:min-w-0"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg transition-transform group-hover:scale-[1.04]" style={{ color: meta.color, backgroundColor: meta.tint }}>
                    <Icon size={14} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-semibold text-[#465b50]">{meta.label}</span>
                    <span className="mt-0.5 hidden truncate text-[9px] text-[#89958c] lg:block">{meta.hint}</span>
                  </span>
                  <Plus size={13} className="shrink-0 text-[#9ba69d] transition-colors group-hover:text-[#26725b]" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className="mt-3 hidden rounded-lg border border-[#e5e9df] bg-[#fffefa] p-3 lg:block">
            <div className="text-[9px] font-bold uppercase tracking-[.11em] text-[#8a978d]">Canvas guide</div>
            <p className="mt-1.5 text-[10px] leading-4 text-[#76847b]">Drag from a dot on one step to another to create a connection. Click a line to add a label or remove it.</p>
          </div>
        </aside>

        <div className="flex min-h-[580px] min-w-0 flex-col">
          {selectedEdge && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[#e6ebe2] bg-[#f5f8f1] px-3 py-2.5 sm:px-4">
              <label htmlFor="flow-edge-label" className="shrink-0 text-[10px] font-semibold text-[#52685b]">Connection label</label>
              <input
                id="flow-edge-label"
                value={selectedEdge.label ?? ''}
                onChange={(event) => updateSelectedEdgeLabel(event.target.value)}
                maxLength={120}
                placeholder="Optional, for example: If order is delayed"
                aria-label="Connection label"
                data-testid="input-edge-label"
                className="h-8 min-w-[160px] flex-1 rounded-md border border-[#dfe6dc] bg-[#fffefa] px-2.5 text-[10px] text-[#34483d] outline-none placeholder:text-[#a1aaa2] focus:border-[#72a58d] focus:ring-2 focus:ring-[#72a58d]/15"
              />
              <button type="button" onClick={deleteSelectedEdge} aria-label="Delete selected connection" data-testid="button-delete-edge" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#ead8d2] bg-[#fffefa] px-2.5 text-[10px] font-semibold text-[#a45143] hover:bg-[#fff4ef]">
                <Trash2 size={12} aria-hidden="true" /> Delete
              </button>
              <button type="button" onClick={() => setSelectedEdgeId(null)} aria-label="Close connection editor" data-testid="button-close-edge-editor" className="grid size-8 place-items-center rounded-md text-[#7c8a80] hover:bg-[#e9eee6]">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          <div
            className="canvas-grid relative min-h-[580px] flex-1"
            data-testid="flow-canvas-viewport"
            onDrop={handlePaletteDrop}
            onDragOver={allowPaletteDrop}
          >
            {graph.nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-5">
                <div className="pointer-events-auto max-w-[320px] rounded-2xl border border-dashed border-[#b9cabb] bg-[#fffefa]/95 p-6 text-center shadow-[0_12px_32px_rgba(40,69,54,.08)]">
                  <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#eaf2e9] text-[#26725b]">
                    <Workflow size={20} aria-hidden="true" />
                  </span>
                  <h3 className="font-display mt-3 text-[15px] font-semibold tracking-[-.02em]">Start with the first moment.</h3>
                  <p className="mt-1.5 text-[10px] leading-5 text-[#7c8980]">Add a trigger, then connect the steps that guide a support conversation.</p>
                  <button type="button" onClick={() => onAddNode('trigger')} data-testid="button-add-first-trigger" className="mt-4 rounded-lg bg-[#26725b] px-3.5 py-2 text-[10px] font-bold text-white transition-colors hover:bg-[#1e604c]">
                    Add a trigger
                  </button>
                </div>
              </div>
            )}

            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={handleConnect}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={() => {
                onSelectedIdChange(null);
                setSelectedEdgeId(null);
              }}
              onNodeDragStart={(_event, node) => onSelectedIdChange(node.id)}
              nodesConnectable
              nodesDraggable
              elementsSelectable
              deleteKeyCode={['Backspace', 'Delete']}
              minZoom={0.25}
              maxZoom={1.6}
              connectionLineType={ConnectionLineType.SmoothStep}
              defaultEdgeOptions={{ type: 'smoothstep', animated: false }}
              proOptions={{ hideAttribution: true }}
              fitView={graph.nodes.length > 0}
              fitViewOptions={{ padding: 0.24 }}
              className="text-[#30463b]"
              aria-label="Interactive chatbot conversation flow canvas"
              data-testid="react-flow-editor"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.1} color="#bac8ba" />
              <MiniMap
                position="bottom-left"
                pannable
                zoomable
                nodeColor={(node) => stepMeta[(node.data as CanvasNodeData).backend.type]?.color ?? '#8b9a8e'}
                maskColor="rgba(239, 241, 232, .65)"
                className="!hidden sm:!block"
              />
              <CanvasViewportControls />
            </ReactFlow>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e8ebe3] bg-[#fffefa] px-3.5 py-2.5 text-[9px] text-[#89958c] sm:px-4">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[#63a17c]" />
              Changes are reflected in the flow graph
            </span>
            <span className="font-mono tracking-[.02em]">SCROLL TO ZOOM <span className="px-1 text-[#c1c9c1]">·</span> SPACE + DRAG TO PAN</span>
          </footer>
        </div>
      </div>
    </section>
  );
}

export function FlowBuilderCanvas(props: FlowBuilderCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowBuilderCanvasContent {...props} />
    </ReactFlowProvider>
  );
}
