import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, ArrowDownLeft, ArrowUpRight, Check, ChevronDown,
  ChevronRight, Clock3, Copy, ExternalLink, KeyRound, LoaderCircle, Plus,
  RotateCw, Send, ShieldCheck, Trash2, Webhook, X,
} from 'lucide-react';
import {
  getListWebhookDeliveriesQueryKey, getListWebhookEndpointsQueryKey,
  getListWebhookEventTypesQueryKey, useCreateWebhookEndpoint,
  useDeleteWebhookEndpoint, useListWebhookDeliveries, useListWebhookEndpoints,
  useListWebhookEventTypes, useRetryWebhookDelivery, useRotateWebhookSecret,
  useTestWebhookEndpoint, useUpdateWebhookEndpoint,
} from '@workspace/api-client-react';
import type {
  WebhookDelivery, WebhookEndpoint, WebhookEndpointInput,
} from '@workspace/api-client-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';

const endpointSchema = z.object({
  name: z.string().trim().min(1, 'Give this endpoint a name.').max(120, 'Use 120 characters or fewer.'),
  direction: z.enum(['outgoing', 'incoming']),
  url: z.string().trim().optional(),
  eventTypes: z.array(z.string()),
}).superRefine((value, ctx) => {
  if (value.direction === 'outgoing') {
    if (!value.url) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'A destination URL is required.' });
    else if (!/^https:\/\/.+/i.test(value.url)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'Use a secure HTTPS URL.' });
    if (!value.eventTypes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['eventTypes'], message: 'Select at least one available event.' });
  }
});
type EndpointFormValues = z.infer<typeof endpointSchema>;

const deliveryParams = (endpointId: string) => ({ endpointId, limit: 25, offset: 0 });
const time = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '—';
const relative = (value?: string | null) => {
  if (!value) return '';
  const minutes = Math.max(0, Math.round((new Date(value).getTime() - Date.now()) / 60000));
  return minutes < 1 ? 'in less than a minute' : `in ${minutes} min`;
};
const readable = (value: string) => value.replaceAll('.', ' · ').replaceAll('_', ' ');

function Button({ className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-lg border border-[#d9dfd7] bg-[#fffefa] px-3 py-2 text-[12px] font-semibold text-[#40564d] transition hover:border-[#aebfb3] hover:bg-[#f7f8f2] disabled:cursor-not-allowed disabled:opacity-50 ${className}`} />;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'delivered' || status === 'succeeded' || status === 'enabled'
    ? 'bg-[#e6f2e9] text-[#347351]'
    : status === 'failed' ? 'bg-[#fff0eb] text-[#a94d3e]'
      : status === 'disabled' || status === 'cancelled' ? 'bg-[#f0f1ec] text-[#737e76]'
        : 'bg-[#fff4e3] text-[#9a6d2d]';
  return <span data-testid={`status-${status}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${tone}`}><span className="size-1.5 rounded-full bg-current" />{status.replaceAll('_', ' ')}</span>;
}

function SkeletonRows() {
  return <div className="space-y-3 p-5" aria-label="Loading endpoints" data-testid="loading-endpoints">{[1, 2, 3].map(n => <div key={n} className="h-[76px] animate-pulse rounded-lg bg-[#f0f2eb]" />)}</div>;
}

export default function WebhookDashboardPage() {
  const queryClient = useQueryClient();
  const endpointsQuery = useListWebhookEndpoints({ query: { queryKey: getListWebhookEndpointsQueryKey() } });
  const eventQuery = useListWebhookEventTypes({ query: { queryKey: getListWebhookEventTypesQueryKey() } });
  const endpoints = endpointsQuery.data ?? [];
  const [selectedId, setSelectedId] = useState('');
  const selected = endpoints.find(endpoint => endpoint.id === selectedId) ?? null;
  const params = useMemo(() => deliveryParams(selectedId || '__no_endpoint__'), [selectedId]);
  const historyQuery = useListWebhookDeliveries(params, {
    query: { queryKey: getListWebhookDeliveriesQueryKey(params), enabled: Boolean(selectedId), refetchInterval: selectedId ? 5000 : false },
  });
  const createMutation = useCreateWebhookEndpoint();
  const updateMutation = useUpdateWebhookEndpoint();
  const deleteMutation = useDeleteWebhookEndpoint();
  const rotateMutation = useRotateWebhookSecret();
  const testMutation = useTestWebhookEndpoint();
  const retryMutation = useRetryWebhookDelivery();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpoint | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<{ secret: string; title: string; path?: string | null } | null>(null);
  const [openDelivery, setOpenDelivery] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const eventTypes = eventQuery.data ?? [];
  const queryKeysFor = (endpointId: string) => getListWebhookDeliveriesQueryKey(deliveryParams(endpointId));

  useEffect(() => {
    if (!selectedId && endpoints.length) setSelectedId(endpoints[0].id);
    if (selectedId && !endpoints.some(endpoint => endpoint.id === selectedId)) setSelectedId(endpoints[0]?.id ?? '');
  }, [endpoints, selectedId]);

  const invalidateEndpointAndHistory = (endpointId?: string) => {
    void queryClient.invalidateQueries({ queryKey: getListWebhookEndpointsQueryKey() });
    if (endpointId) void queryClient.invalidateQueries({ queryKey: queryKeysFor(endpointId) });
    else if (selectedId) void queryClient.invalidateQueries({ queryKey: queryKeysFor(selectedId) });
  };
  const startCreate = (direction: 'outgoing' | 'incoming') => {
    setEditing(null);
    setNotice('');
    setFormOpen(true);
    setTimeout(() => window.dispatchEvent(new CustomEvent('webhook-create-direction', { detail: direction })), 0);
  };

  const onToggle = (endpoint: WebhookEndpoint, enabled: boolean) => {
    setNotice('');
    updateMutation.mutate({ endpointId: endpoint.id, data: { isEnabled: enabled } }, {
      onSuccess: () => { invalidateEndpointAndHistory(endpoint.id); setNotice(`${endpoint.name} ${enabled ? 'enabled' : 'disabled'}.`); },
    });
  };
  const onDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteMutation.mutate({ endpointId: target.id }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListWebhookEndpointsQueryKey() });
        void queryClient.removeQueries({ queryKey: queryKeysFor(target.id) });
        if (selectedId === target.id) setSelectedId('');
        setDeleteTarget(null);
        setNotice('Endpoint and its delivery history were removed.');
      },
    });
  };
  const onRotate = (endpoint: WebhookEndpoint) => {
    if (!window.confirm(`Rotate the signing secret for “${endpoint.name}”? The current secret stops working immediately.`)) return;
    rotateMutation.mutate({ endpointId: endpoint.id }, {
      onSuccess: response => {
        invalidateEndpointAndHistory(endpoint.id);
        setOneTimeSecret({ secret: response.signingSecret, title: 'New signing secret' });
      },
    });
  };
  const onTest = (endpoint: WebhookEndpoint) => {
    testMutation.mutate({ endpointId: endpoint.id }, {
      onSuccess: () => { invalidateEndpointAndHistory(endpoint.id); setNotice('Signed test delivery queued.'); },
    });
  };
  const onRetry = (delivery: WebhookDelivery) => {
    retryMutation.mutate({ deliveryId: delivery.id }, { onSuccess: () => invalidateEndpointAndHistory(delivery.endpointId) });
  };

  return <div className="fade-up space-y-6" data-testid="webhook-dashboard">
    <header className="flex flex-col justify-between gap-5 border-b border-[#e4e6dd] pb-6 lg:flex-row lg:items-end">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#bf704e]"><Webhook size={13} /> Workspace / Integrations</div>
        <h1 className="font-display text-[30px] font-semibold tracking-[-.055em] text-[#1c3932] md:text-[36px]">Webhook connections</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#718078]">Connect ChatMaster to the systems your team relies on. Manage signed endpoints and inspect every delivery from one place.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button data-testid="button-create-incoming" onClick={() => startCreate('incoming')}><ArrowDownLeft size={14} /> Incoming endpoint</Button>
        <Button data-testid="button-create-outgoing" onClick={() => startCreate('outgoing')} className="border-[#1f6653] bg-[#1f6653] text-white hover:bg-[#174e40]"><Plus size={14} /> Add outgoing</Button>
      </div>
    </header>

    {notice && <div role="status" data-testid="status-notice" className="flex items-center gap-2 rounded-lg border border-[#cfe3d3] bg-[#f0f7f0] px-4 py-3 text-[12px] font-medium text-[#347351]"><Check size={15} />{notice}<button data-testid="button-dismiss-notice" aria-label="Dismiss notification" onClick={() => setNotice('')} className="ml-auto"><X size={14} /></button></div>}

    <section className="grid gap-4 sm:grid-cols-3" aria-label="Webhook overview">
      <div className="rounded-xl border border-[#e1e4dc] bg-[#fffefa] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.11em] text-[#89958c]"><Webhook size={13} /> Endpoints</div><div className="font-display mt-3 text-[26px] font-semibold text-[#1c3932]" data-testid="text-endpoint-count">{endpointsQuery.isLoading ? '—' : endpoints.length}</div><div className="mt-1 text-[10px] text-[#859188]">Configured in this workspace</div></div>
      <div className="rounded-xl border border-[#e1e4dc] bg-[#fffefa] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.11em] text-[#89958c]"><Activity size={13} /> Active</div><div className="font-display mt-3 text-[26px] font-semibold text-[#1c3932]" data-testid="text-active-count">{endpointsQuery.isLoading ? '—' : endpoints.filter(endpoint => endpoint.isEnabled).length}</div><div className="mt-1 text-[10px] text-[#859188]">Accepting or sending events</div></div>
      <div className="rounded-xl border border-[#e1e4dc] bg-[#fffefa] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.11em] text-[#89958c]"><ShieldCheck size={13} /> Signing</div><div className="mt-3 text-[17px] font-semibold text-[#1c3932]" data-testid="text-signing-policy">HMAC-SHA256</div><div className="mt-1 text-[10px] text-[#859188]">Secrets are shown once, at creation or rotation</div></div>
    </section>

    {endpointsQuery.isError && <div data-testid="error-endpoints" className="flex items-center justify-between rounded-xl border border-[#efd2c9] bg-[#fff7f3] p-4"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 text-[#b05243]" size={17} /><div><div className="text-[12px] font-semibold text-[#80463a]">Endpoints could not be loaded</div><p className="mt-1 text-[11px] text-[#9b7168]">The workspace connection may be temporarily unavailable.</p></div></div><Button data-testid="button-retry-endpoints" onClick={() => void endpointsQuery.refetch()}>Try again</Button></div>}

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="overflow-hidden rounded-xl border border-[#dfe3da] bg-[#fffefa]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaebe3] px-5 py-4">
          <div><h2 className="font-display text-[16px] font-semibold text-[#263d35]">Endpoints</h2><p className="mt-1 text-[10px] text-[#849088]">Select a connection to review its delivery activity.</p></div>
          <span className="rounded-md bg-[#f1f3ed] px-2.5 py-1 text-[10px] font-semibold text-[#718078]" data-testid="text-endpoint-list-state">{endpoints.length} configured</span>
        </div>
        {endpointsQuery.isLoading ? <SkeletonRows /> : endpointsQuery.isError ? <div data-testid="state-endpoints-error" className="p-6 text-[12px] text-[#7a8981]">Endpoint list is unavailable. Use the retry control above to try again.</div> : endpoints.length === 0 ? <div data-testid="state-endpoints-empty" className="px-6 py-12 text-center"><div className="mx-auto grid size-11 place-items-center rounded-xl bg-[#edf3eb] text-[#37745f]"><Webhook size={19} /></div><h3 className="font-display mt-4 text-[17px] font-semibold text-[#2a4038]">No webhook endpoints yet</h3><p className="mx-auto mt-2 max-w-sm text-[12px] leading-5 text-[#7b8981]">Create an outgoing endpoint to receive ChatMaster events, or an incoming endpoint to accept your signed events.</p><div className="mt-5 flex justify-center gap-2"><Button data-testid="button-empty-incoming" onClick={() => startCreate('incoming')}>Create incoming</Button><Button data-testid="button-empty-outgoing" onClick={() => startCreate('outgoing')} className="bg-[#1f6653] text-white">Create outgoing</Button></div></div> : <div className="divide-y divide-[#eff0e9]">
          {endpoints.map(endpoint => <article key={endpoint.id} data-testid={`row-endpoint-${endpoint.id}`} className={`px-4 py-4 transition sm:px-5 ${selectedId === endpoint.id ? 'bg-[#f7f8f2]' : 'hover:bg-[#fbfbf7]'}`}>
            <div className="flex items-start gap-3">
              <button data-testid={`button-select-endpoint-${endpoint.id}`} aria-label={`View ${endpoint.name} delivery history`} onClick={() => setSelectedId(endpoint.id)} className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#e1e7df] bg-white text-[#31745f]">{endpoint.direction === 'outgoing' ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}</button>
              <button data-testid={`button-open-endpoint-${endpoint.id}`} onClick={() => setSelectedId(endpoint.id)} className="min-w-0 flex-1 text-left">
                <span className="flex flex-wrap items-center gap-2"><span className="truncate text-[13px] font-semibold text-[#2a4038]" data-testid={`text-endpoint-name-${endpoint.id}`}>{endpoint.name}</span><span className="rounded bg-[#f0f2eb] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#758078]">{endpoint.direction}</span></span>
                <span className="mt-1 block truncate font-mono text-[10px] text-[#88948b]" data-testid={`text-endpoint-url-${endpoint.id}`}>{endpoint.url || (endpoint.direction === 'incoming' ? 'ChatMaster signed ingress' : 'No destination URL')}</span>
                <span className="mt-2 flex flex-wrap gap-1.5">{endpoint.eventTypes.map(event => <span key={event} className="rounded-md border border-[#e8ebe3] bg-white px-2 py-1 font-mono text-[9px] text-[#63756c]">{event}</span>)}</span>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusBadge status={endpoint.isEnabled ? 'enabled' : 'disabled'} />
                <button data-testid={`button-edit-endpoint-${endpoint.id}`} onClick={() => { setEditing(endpoint); setFormOpen(true); }} className="text-[10px] font-semibold text-[#397761] hover:underline">Edit</button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#ebede5] pt-3">
              <Button data-testid={`button-toggle-endpoint-${endpoint.id}`} disabled={updateMutation.isPending} onClick={() => onToggle(endpoint, !endpoint.isEnabled)} className="px-2.5 py-1.5 text-[10px]">{endpoint.isEnabled ? 'Disable' : 'Enable'}</Button>
              {endpoint.direction === 'outgoing' && <Button data-testid={`button-test-endpoint-${endpoint.id}`} disabled={!endpoint.isEnabled || testMutation.isPending} onClick={() => onTest(endpoint)} className="px-2.5 py-1.5 text-[10px]"><Send size={12} /> Send signed test</Button>}
              <Button data-testid={`button-rotate-secret-${endpoint.id}`} disabled={rotateMutation.isPending} onClick={() => onRotate(endpoint)} className="px-2.5 py-1.5 text-[10px]"><KeyRound size={12} /> Rotate secret</Button>
              <button data-testid={`button-delete-endpoint-${endpoint.id}`} onClick={() => setDeleteTarget(endpoint)} className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold text-[#a34e42] hover:bg-[#fff1ed]"><Trash2 size={12} /> Delete</button>
            </div>
            {endpoint.direction === 'incoming' && <p className="mt-3 flex items-start gap-2 rounded-md bg-[#f3f5ef] px-3 py-2 text-[10px] leading-4 text-[#6d7d73]"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-[#34765f]" />Accepts the documented ChatMaster HMAC envelope only; this is not a provider-specific adapter.</p>}
          </article>)}
        </div>}
      </section>

      <section className="overflow-hidden rounded-xl border border-[#dfe3da] bg-[#fffefa] xl:sticky xl:top-[92px]">
        <div className="flex items-start justify-between border-b border-[#eaebe3] px-5 py-4"><div><div className="flex items-center gap-2"><h2 className="font-display text-[16px] font-semibold text-[#263d35]">Delivery history</h2>{selected && <span className="size-1.5 rounded-full bg-[#48a36e]" title="Auto-refreshing" />}</div><p className="mt-1 max-w-[270px] truncate text-[10px] text-[#849088]" data-testid="text-history-endpoint">{selected ? selected.name : 'Choose an endpoint to inspect attempts'}</p></div><Button data-testid="button-refresh-history" disabled={!selectedId || historyQuery.isFetching} onClick={() => void historyQuery.refetch()} className="px-2.5 py-1.5 text-[10px]"><RotateCw size={12} className={historyQuery.isFetching ? 'animate-spin' : ''} /> Refresh</Button></div>
        {!selected ? <div className="px-5 py-12 text-center" data-testid="state-history-unselected"><div className="mx-auto grid size-10 place-items-center rounded-full bg-[#f0f2eb] text-[#829087]"><Activity size={17} /></div><p className="mt-3 text-[11px] leading-5 text-[#849088]">Select an endpoint to see recent event deliveries and per-attempt diagnostics.</p></div>
          : historyQuery.isLoading ? <div className="space-y-3 p-5" data-testid="loading-history">{[1, 2, 3].map(n => <div key={n} className="h-[68px] animate-pulse rounded-lg bg-[#f0f2eb]" />)}</div>
            : historyQuery.isError ? <div className="m-4 rounded-lg border border-[#efd2c9] bg-[#fff7f3] p-4" data-testid="error-history"><p className="text-[11px] font-semibold text-[#80463a]">Delivery history could not be loaded.</p><Button data-testid="button-retry-history" onClick={() => void historyQuery.refetch()} className="mt-3">Try again</Button></div>
              : !historyQuery.data?.length ? <div className="px-5 py-10 text-center" data-testid="state-history-empty"><Clock3 className="mx-auto text-[#a0aaa2]" size={20} /><p className="mt-3 text-[12px] font-semibold text-[#53665d]">No deliveries recorded</p><p className="mt-1 text-[10px] text-[#8a958d]">New events will appear here as they are sent.</p></div>
                : <div className="max-h-[650px] divide-y divide-[#eff0e9] overflow-y-auto">
                  {historyQuery.data.map(delivery => <DeliveryRow key={delivery.id} delivery={delivery} expanded={openDelivery === delivery.id} onToggle={() => setOpenDelivery(openDelivery === delivery.id ? null : delivery.id)} onRetry={() => onRetry(delivery)} retrying={retryMutation.isPending} />)}
                </div>}
        <div className="flex items-center justify-between border-t border-[#eaebe3] px-5 py-3 text-[9px] text-[#89948c]"><span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#56a775]" />Updates every 5 seconds</span><span>{selected ? 'Most recent 25' : ''}</span></div>
      </section>
    </div>

    <EndpointDialog open={formOpen} onOpenChange={open => { setFormOpen(open); if (!open) setEditing(null); }} editing={editing} eventTypes={eventTypes} eventTypesLoading={eventQuery.isLoading} onCreated={(response) => {
      void queryClient.invalidateQueries({ queryKey: getListWebhookEndpointsQueryKey() });
      setSelectedId(response.endpoint.id);
      setFormOpen(false);
      setOneTimeSecret({ secret: response.signingSecret, title: 'Endpoint signing secret', path: response.inboundPath });
    }} onUpdated={endpoint => { invalidateEndpointAndHistory(endpoint.id); setFormOpen(false); setEditing(null); setNotice('Endpoint settings saved.'); }} createPending={createMutation.isPending} updatePending={updateMutation.isPending} createEndpoint={createMutation.mutate} updateEndpoint={updateMutation.mutate} />

    <Dialog open={Boolean(oneTimeSecret)} onOpenChange={open => { if (!open) setOneTimeSecret(null); }}>
      <DialogContent className="max-w-[560px] border-[#dce2d8] bg-[#fffefa]">
        <DialogHeader><div className="mb-2 grid size-10 place-items-center rounded-xl bg-[#edf4ed] text-[#32745c]"><KeyRound size={18} /></div><DialogTitle className="font-display text-[#253d35]">{oneTimeSecret?.title}</DialogTitle><DialogDescription className="text-[12px] leading-5">Copy this value now and store it in your secret manager. ChatMaster will not display it again after this dialog closes.</DialogDescription></DialogHeader>
        {oneTimeSecret?.path && <div className="rounded-lg border border-[#e5e8df] bg-[#f6f7f1] p-3"><div className="mb-1 text-[9px] font-bold uppercase tracking-[.12em] text-[#7f8d83]">Signed ingress path</div><code className="break-all font-mono text-[11px] text-[#35594b]">{oneTimeSecret.path}</code></div>}
        <SecretValue value={oneTimeSecret?.secret ?? ''} />
        <div className="flex items-start gap-2 rounded-lg border border-[#f0ddbf] bg-[#fff8ec] p-3 text-[10px] leading-4 text-[#856b40]"><AlertCircle size={14} className="mt-0.5 shrink-0" />Treat this secret like a password. Rotation immediately invalidates the previous signing secret.</div>
        <DialogFooter><Button data-testid="button-close-secret" onClick={() => setOneTimeSecret(null)} className="bg-[#1f6653] text-white hover:bg-[#174e40]">I’ve copied the secret</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
      <DialogContent className="max-w-[470px] border-[#dce2d8] bg-[#fffefa]">
        <DialogHeader><div className="mb-2 grid size-10 place-items-center rounded-xl bg-[#fff0eb] text-[#a64e40]"><Trash2 size={17} /></div><DialogTitle className="font-display text-[#253d35]">Delete this endpoint?</DialogTitle><DialogDescription className="text-[12px] leading-5">You are about to delete <strong>{deleteTarget?.name}</strong>. Its delivery history and attempt diagnostics will also be permanently removed. This cannot be undone.</DialogDescription></DialogHeader>
        {deleteMutation.isError && <p role="alert" data-testid="error-delete-endpoint" className="text-[11px] text-[#a34e42]">The endpoint could not be deleted. Try again.</p>}
        <DialogFooter><Button data-testid="button-cancel-delete" onClick={() => setDeleteTarget(null)}>Keep endpoint</Button><Button data-testid="button-confirm-delete" disabled={deleteMutation.isPending} onClick={onDelete} className="border-[#a84e42] bg-[#a84e42] text-white hover:bg-[#893d34]">{deleteMutation.isPending ? 'Deleting…' : 'Delete endpoint and history'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function EndpointDialog({
  open, onOpenChange, editing, eventTypes, eventTypesLoading, onCreated, onUpdated,
  createPending, updatePending, createEndpoint, updateEndpoint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: WebhookEndpoint | null;
  eventTypes: { eventType: string; description: string }[];
  eventTypesLoading: boolean;
  onCreated: (response: { endpoint: WebhookEndpoint; signingSecret: string; inboundPath: string | null }) => void;
  onUpdated: (endpoint: WebhookEndpoint) => void;
  createPending: boolean;
  updatePending: boolean;
  createEndpoint: ReturnType<typeof useCreateWebhookEndpoint>['mutate'];
  updateEndpoint: ReturnType<typeof useUpdateWebhookEndpoint>['mutate'];
}) {
  const form = useForm<EndpointFormValues>({
    resolver: zodResolver(endpointSchema),
    defaultValues: { name: '', direction: 'outgoing', url: '', eventTypes: [] },
  });
  const direction = form.watch('direction');
  useEffect(() => {
    form.reset(editing ? {
      name: editing.name, direction: editing.direction, url: editing.url ?? '', eventTypes: [...editing.eventTypes],
    } : { name: '', direction: 'outgoing', url: '', eventTypes: [] });
  }, [editing, form, open]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<'outgoing' | 'incoming'>).detail;
      if (!editing) form.setValue('direction', detail, { shouldValidate: true });
    };
    window.addEventListener('webhook-create-direction', listener);
    return () => window.removeEventListener('webhook-create-direction', listener);
  }, [editing, form]);

  const submit = (values: EndpointFormValues) => {
    if (editing) {
      updateEndpoint({ endpointId: editing.id, data: {
        name: values.name, url: editing.direction === 'outgoing' ? values.url?.trim() : null,
        eventTypes: editing.direction === 'outgoing' ? values.eventTypes : undefined,
      } }, { onSuccess: onUpdated });
      return;
    }
    const data: WebhookEndpointInput = {
      name: values.name,
      direction: values.direction,
      url: values.direction === 'outgoing' ? values.url?.trim() : null,
      eventTypes: values.direction === 'outgoing' ? values.eventTypes as WebhookEndpointInput['eventTypes'] : [],
    };
    createEndpoint({ data }, { onSuccess: onCreated });
  };
  const displayedDirection = editing?.direction ?? direction;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-[600px] border-[#dce2d8] bg-[#fffefa]">
      <DialogHeader><div className="mb-2 grid size-10 place-items-center rounded-xl bg-[#edf4ed] text-[#32745c]"><Webhook size={18} /></div><DialogTitle className="font-display text-[#253d35]">{editing ? 'Edit endpoint' : 'Add webhook endpoint'}</DialogTitle><DialogDescription className="text-[12px] leading-5">{editing ? 'Update this connection’s name, URL, and event subscriptions.' : 'Choose how this endpoint connects with your workspace. Signing secrets are revealed once after creation.'}</DialogDescription></DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          {!editing && <FormField control={form.control} name="direction" render={({ field }) => <FormItem><FormLabel className="text-[11px] font-semibold text-[#52665c]">Connection direction</FormLabel><FormControl><div className="grid grid-cols-2 gap-2">
            {(['outgoing', 'incoming'] as const).map(value => <button type="button" key={value} data-testid={`button-direction-${value}`} onClick={() => field.onChange(value)} className={`rounded-lg border p-3 text-left ${field.value === value ? 'border-[#4c9277] bg-[#f1f7f0]' : 'border-[#e1e5dc] bg-white'}`}><span className="flex items-center gap-2 text-[11px] font-bold capitalize text-[#344d42]">{value === 'outgoing' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}{value}</span><span className="mt-1 block text-[9px] leading-4 text-[#829087]">{value === 'outgoing' ? 'Send ChatMaster events to your system' : 'Accept signed events into ChatMaster'}</span></button>)}
          </div></FormControl></FormItem>} />
          <FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel className="text-[11px] font-semibold text-[#52665c]">Endpoint name</FormLabel><FormControl><input {...field} data-testid="input-endpoint-name" placeholder="e.g. Order operations" className="h-10 w-full rounded-lg border border-[#dce2d8] bg-[#fbfcf8] px-3 text-[12px] text-[#31483e] outline-none focus:border-[#61967d] focus:ring-2 focus:ring-[#d9eadf]" /></FormControl><FormMessage /></FormItem>} />
          {displayedDirection === 'outgoing' && <FormField control={form.control} name="url" render={({ field }) => <FormItem><FormLabel className="text-[11px] font-semibold text-[#52665c]">Destination URL</FormLabel><FormControl><input {...field} type="url" data-testid="input-endpoint-url" placeholder="https://your-system.example.com/hooks/chatmaster" className="h-10 w-full rounded-lg border border-[#dce2d8] bg-[#fbfcf8] px-3 font-mono text-[11px] text-[#31483e] outline-none focus:border-[#61967d] focus:ring-2 focus:ring-[#d9eadf]" /></FormControl><FormDescription className="text-[10px]">HTTPS is required. Requests include ChatMaster’s signature headers.</FormDescription><FormMessage /></FormItem>} />}
          {displayedDirection === 'outgoing' && <FormField control={form.control} name="eventTypes" render={({ field }) => <FormItem><div className="mb-2 flex items-end justify-between"><FormLabel className="text-[11px] font-semibold text-[#52665c]">Subscribe to events</FormLabel><span className="text-[9px] text-[#8a958d]">Only events available in this workspace</span></div><FormControl><div className="space-y-2 rounded-lg border border-[#e3e7de] p-3">
            {eventTypesLoading ? <div data-testid="loading-event-types" className="h-12 animate-pulse rounded bg-[#f0f2eb]" /> : eventQueryErrorFallback(eventTypes.length) ? <div className="text-[10px] text-[#8a958d]">No event types are currently available. Retry event loading before creating this endpoint.</div> : eventTypes.map(event => {
              const checked = field.value.includes(event.eventType);
              return <label key={event.eventType} className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-[#f7f8f2]"><Checkbox data-testid={`checkbox-event-${event.eventType}`} checked={checked} onCheckedChange={value => field.onChange(value ? [...field.value, event.eventType] : field.value.filter(item => item !== event.eventType))} /><span><span className="block font-mono text-[10px] font-semibold text-[#385b4b]">{event.eventType}</span><span className="mt-0.5 block text-[10px] leading-4 text-[#839087]">{event.description}</span></span></label>;
            })}
          </div></FormControl><FormMessage /></FormItem>} />}
          {displayedDirection === 'incoming' && <div className="rounded-lg border border-[#e1e7dd] bg-[#f4f7f1] p-3.5 text-[10px] leading-5 text-[#69796f]" data-testid="notice-incoming-limits"><div className="mb-1 flex items-center gap-2 font-semibold text-[#3e6957]"><ShieldCheck size={14} /> ChatMaster HMAC envelope</div>This endpoint accepts the documented ChatMaster envelope with an HMAC-SHA256 signature. It is not a provider-specific adapter. Use the returned ingress path and sign the exact request body with the timestamp.</div>}
          <DialogFooter className="gap-2 pt-2"><Button type="button" data-testid="button-cancel-endpoint-form" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" data-testid="button-submit-endpoint" disabled={createPending || updatePending || (displayedDirection === 'outgoing' && (!eventTypes.length || eventTypesLoading))} className="border-[#1f6653] bg-[#1f6653] text-white hover:bg-[#174e40]">{createPending || updatePending ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{editing ? 'Save changes' : 'Create endpoint'}</Button></DialogFooter>
          {(createPending || updatePending) && <span className="sr-only" data-testid="status-endpoint-saving">Saving endpoint</span>}
        </form>
      </Form>
    </DialogContent>
  </Dialog>;
}

function eventQueryErrorFallback(count: number) { return count === 0; }

function SecretValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <div className="flex items-center gap-2 rounded-lg border border-[#dce3d9] bg-[#f4f6ef] p-3" data-testid="secret-display"><code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-[#315846]">{value}</code><button type="button" data-testid="button-copy-secret" onClick={() => void copy()} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#d3ddd2] bg-white px-2.5 py-2 text-[10px] font-bold text-[#426253]">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button></div>;
}

function DeliveryRow({ delivery, expanded, onToggle, onRetry, retrying }: {
  delivery: WebhookDelivery; expanded: boolean; onToggle: () => void; onRetry: () => void; retrying: boolean;
}) {
  const status = delivery.status;
  return <article data-testid={`row-delivery-${delivery.id}`} className="px-4 py-3.5">
    <div className="flex items-start gap-2">
      <button data-testid={`button-expand-delivery-${delivery.id}`} aria-expanded={expanded} onClick={onToggle} className="mt-1 rounded p-0.5 text-[#8c9890] hover:bg-[#eff2eb]">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="truncate font-mono text-[10px] font-semibold text-[#365a4a]" data-testid={`text-delivery-type-${delivery.id}`}>{delivery.eventType}</span><StatusBadge status={status} /></div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-[#8a958d]"><span>{time(delivery.createdAt)}</span><span>{delivery.attemptCount} {delivery.attemptCount === 1 ? 'attempt' : 'attempts'}</span>{delivery.httpStatus && <span className="font-mono">HTTP {delivery.httpStatus}</span>}</div>
        {delivery.lastError && <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[#a45c4f]" data-testid={`text-delivery-error-${delivery.id}`}>{delivery.lastError}</p>}
        {status === 'pending' && delivery.nextAttemptAt && <p className="mt-2 flex items-center gap-1 text-[9px] text-[#9a6d2d]" data-testid={`status-delivery-next-attempt-${delivery.id}`}><Clock3 size={11} />Retry scheduled {relative(delivery.nextAttemptAt)}</p>}
      </div>
    </div>
    {expanded && <div className="ml-6 mt-3 space-y-2 border-l border-[#dfe6dc] pl-3" data-testid={`details-delivery-${delivery.id}`}>
      <div className="mb-2 font-mono text-[9px] text-[#929d95]">Event {delivery.eventId}</div>
      {!delivery.attempts.length ? <p className="text-[10px] text-[#89948c]">No delivery attempts have started.</p> : delivery.attempts.map(attempt => <div key={attempt.id} data-testid={`row-attempt-${delivery.id}-${attempt.attemptNumber}`} className="rounded-md border border-[#e8ebe3] bg-[#fafbf7] p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-semibold text-[#52665c]">Attempt {attempt.attemptNumber}</span><StatusBadge status={attempt.status} /></div>
        <div className="mt-1.5 grid grid-cols-2 gap-2 text-[9px] text-[#849088]"><span>Started {time(attempt.requestStartedAt)}</span><span>Finished {time(attempt.finishedAt)}</span></div>
        {attempt.responseStatus !== null && <div className="mt-1 font-mono text-[9px] text-[#62766a]" data-testid={`text-attempt-response-${attempt.id}`}>Response {attempt.responseStatus}</div>}
        {attempt.errorMessage && <div className="mt-1 text-[9px] leading-4 text-[#a45c4f]" data-testid={`text-attempt-error-${attempt.id}`}>{attempt.errorMessage}</div>}
      </div>)}
      {status === 'failed' && <Button data-testid={`button-retry-delivery-${delivery.id}`} disabled={retrying} onClick={onRetry} className="mt-1 border-[#ead2c8] text-[#a35043] hover:bg-[#fff1ed]"><RotateCw size={12} />{retrying ? 'Queueing retry…' : 'Retry delivery'}</Button>}
    </div>}
  </article>;
}
