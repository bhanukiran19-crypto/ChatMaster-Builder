import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ClerkProvider, Show, SignIn, SignUp, useClerk } from '@clerk/react';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown,
  CircleHelp, Command, GitBranch, LayoutDashboard, LogOut, Menu,
  MessageSquareText, MoreHorizontal, Plus, Save, Settings2, Sparkles, Trash2,
  Workflow, X, Zap,
} from 'lucide-react';
import {
  FlowNodeType, getGetCurrentUserQueryKey, getGetDashboardSummaryQueryKey,
  getGetFlowQueryKey, getHealthCheckQueryKey, getListFlowsQueryKey,
  useCreateFlow, useDeleteFlow, useGetCurrentUser, useGetDashboardSummary,
  useGetFlow, useHealthCheck, useListFlows, useUpdateFlow,
} from '@workspace/api-client-react';
import type { Flow, FlowButton, FlowEdge, FlowGraph, FlowNode } from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
// @clerk/react 5.54 does not export the Replit guide's host resolver. Replit
// provisions the correct environment key into this app's Vite environment.
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#1f6653',
    colorForeground: '#1d302d',
    colorMutedForeground: '#687975',
    colorDanger: '#c4483e',
    colorBackground: '#fffefa',
    colorInput: '#f8f7f1',
    colorInputForeground: '#1d302d',
    colorNeutral: '#d9ded7',
    fontFamily: 'DM Sans',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fffefa] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#1d302d] font-semibold',
    headerSubtitle: 'text-[#687975]',
    socialButtonsBlockButtonText: 'text-[#1d302d] font-medium',
    formFieldLabel: 'text-[#354a45] font-medium',
    footerActionLink: 'text-[#1f6653] font-semibold',
    footerActionText: 'text-[#687975]',
    dividerText: 'text-[#687975]',
    identityPreviewEditButton: 'text-[#1f6653]',
    formFieldSuccessText: 'text-[#1f6653]',
    alertText: 'text-[#8c332d]',
    logoBox: 'rounded-lg overflow-hidden',
    logoImage: 'rounded-lg',
    socialButtonsBlockButton: 'border-[#d9ded7] hover:bg-[#f5f4ed]',
    formButtonPrimary: 'bg-[#1f6653] hover:bg-[#174e40] text-white',
    formFieldInput: 'bg-[#f8f7f1] border-[#d9ded7] text-[#1d302d]',
    footerAction: 'border-t border-[#e7e7dd]',
    dividerLine: 'bg-[#d9ded7]',
    alert: 'bg-[#fff2ef] border-[#f0c9c0]',
    otpCodeFieldInput: 'border-[#d9ded7] text-[#1d302d]',
    formFieldRow: 'text-[#354a45]',
    main: 'bg-transparent',
  },
};

function Logo({ light = false }: { light?: boolean }) {
  return <span className={`inline-flex items-center gap-2.5 ${light ? 'text-[#f7f4e9]' : 'text-[#1c332e]'}`}>
    <span className="grid size-9 place-items-center rounded-xl bg-[#ed8053] text-white"><Workflow size={19} strokeWidth={2.4} /></span>
    <span className="font-display text-[19px] font-bold tracking-[-.055em]">ChatMaster</span>
  </span>;
}

function Home() {
  return <div className="min-h-[100dvh] overflow-hidden bg-[#f9f7ef] text-[#1c332e]">
    <header className="relative z-10 mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 md:px-10">
      <Link href="/"><Logo /></Link>
      <nav className="hidden items-center gap-9 text-[13px] font-semibold text-[#546761] md:flex">
        <a href="#how-it-works" className="transition-colors hover:text-[#1f6653]">How it works</a>
        <a href="#built-for-teams" className="transition-colors hover:text-[#1f6653]">For your team</a>
      </nav>
      <div className="flex items-center gap-2">
        <Link href="/sign-in" className="rounded-lg px-3 py-2 text-sm font-semibold text-[#344b45] hover:bg-[#efeee6]">Sign in</Link>
        <Link href="/sign-up" className="rounded-lg bg-[#1f6653] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174e40]">Start building <ArrowRight className="ml-1 inline" size={15} /></Link>
      </div>
    </header>
    <main>
      <section className="hero-grid relative mx-auto grid max-w-[1240px] items-center gap-12 px-5 pb-20 pt-14 md:grid-cols-[.95fr_1.05fr] md:px-10 md:pb-28 md:pt-20">
        <div className="fade-up relative z-10">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#dce4d9] bg-[#fffefa]/80 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.13em] text-[#28644f]"><span className="size-1.5 rounded-full bg-[#ed8053]" /> Conversation flows, minus the fuss</div>
          <h1 className="font-display max-w-[640px] text-[48px] font-semibold leading-[1.02] tracking-[-.065em] text-[#19352f] sm:text-[64px] lg:text-[72px]">Customer chats.<br /><span className="text-[#23806a]">Handled with care.</span></h1>
          <p className="mt-6 max-w-[475px] text-[16px] leading-7 text-[#61716b]">Build clear, dependable conversation flows your team can actually own. Set it live, keep an eye on it, make changes when you need to.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/sign-up" className="rounded-xl bg-[#1f6653] px-5 py-3.5 text-sm font-bold text-white shadow-[0_8px_22px_rgba(31,102,83,.18)] transition hover:-translate-y-0.5 hover:bg-[#174e40]">Create your workspace <ArrowRight className="ml-2 inline" size={16} /></Link>
            <a href="#how-it-works" className="rounded-xl border border-[#d6ddd4] bg-[#fffefa] px-5 py-3.5 text-sm font-bold text-[#35534a] hover:bg-[#f1f0e8]">See how it works</a>
          </div>
          <div className="mt-8 flex items-center gap-3 text-[12px] text-[#77847e]"><span className="flex -space-x-2"><span className="grid size-7 place-items-center rounded-full border-2 border-[#f9f7ef] bg-[#dce9df] text-[10px] font-bold text-[#28644f]">01</span><span className="grid size-7 place-items-center rounded-full border-2 border-[#f9f7ef] bg-[#f8d9c8] text-[10px] font-bold text-[#96553d]">02</span><span className="grid size-7 place-items-center rounded-full border-2 border-[#f9f7ef] bg-[#e4e0c9] text-[10px] font-bold text-[#5e6343]">03</span></span><span>Built for the people who know your customers best.</span></div>
        </div>
        <div className="fade-up-delay relative mx-auto w-full max-w-[560px]">
          <div className="absolute -right-7 -top-8 size-32 rounded-full bg-[#f1b98e]/30 blur-2xl" />
          <div className="relative rounded-[22px] border border-[#dce1d5] bg-[#fffefa] p-4 shadow-[0_26px_80px_rgba(26,58,49,.13)] sm:p-6">
            <div className="flex items-center justify-between border-b border-[#e9e9df] pb-4">
              <div><div className="text-[10px] font-bold uppercase tracking-[.13em] text-[#809087]">Flow preview</div><div className="mt-1 font-display text-[17px] font-semibold">New customer hello</div></div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f8eee4] px-2.5 py-1 text-[10px] font-bold text-[#a45e3f]"><span className="size-1.5 rounded-full bg-[#ed8053]" /> SAMPLE</span>
            </div>
            <div className="canvas-grid relative mt-4 min-h-[330px] overflow-hidden rounded-xl border border-[#e1e5db] p-5">
              <div className="absolute left-[54px] top-[78px] h-[162px] border-l border-dashed border-[#92aa9d]" />
              <div className="relative z-10 mx-auto mb-5 w-[245px] rounded-xl border border-[#d9e4d8] bg-[#fffefa] p-3.5 shadow-sm">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.1em] text-[#2b7b64]"><Zap size={13} /> Trigger</div>
                <div className="mt-2 text-[13px] font-semibold">When a conversation starts</div>
              </div>
              <div className="relative z-10 mx-auto w-[245px] rounded-xl border border-[#e8dfd2] bg-[#fffefa] p-3.5 shadow-sm">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.1em] text-[#ca7950]"><MessageSquareText size={13} /> Message</div>
                <div className="mt-2 text-[13px] leading-5 text-[#445951]">Hi there. What can we help you with today?</div>
                <div className="mt-3 flex gap-1.5"><span className="rounded-md border border-[#e1e4da] px-2 py-1 text-[9px] text-[#65736d]">Orders</span><span className="rounded-md border border-[#e1e4da] px-2 py-1 text-[9px] text-[#65736d]">Something else</span></div>
              </div>
              <div className="absolute bottom-4 right-4 rounded-lg border border-[#e7e6dc] bg-[#fffefa] px-3 py-2 text-[10px] font-semibold text-[#65736d]"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-[#42a36b]" /> Ready to publish</div>
            </div>
            <div className="flex items-center justify-between px-1 pt-4 text-[11px] text-[#7a8981]"><span>Simple by design. Yours to control.</span><span className="inline-flex items-center gap-1"><Check size={13} className="text-[#2b7b64]" /> Saved just now</span></div>
          </div>
          <div className="absolute -bottom-5 -left-6 hidden rounded-xl border border-[#e6e3d8] bg-[#fffefa] px-4 py-3 shadow-lg sm:block"><div className="text-[10px] text-[#7c8a83]">Saved flows</div><div className="mt-0.5 font-display text-xl font-bold">Always in view</div></div>
        </div>
      </section>
      <section id="how-it-works" className="border-y border-[#e8e5da] bg-[#f0efe6]">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-16 md:grid-cols-[.75fr_1.25fr] md:px-10 md:py-20">
          <div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#c66e49]">Clear from the first click</div><h2 className="font-display mt-4 text-3xl font-semibold tracking-[-.045em] md:text-[42px]">A good conversation<br />has a simple shape.</h2><p className="mt-4 max-w-sm text-sm leading-6 text-[#68766f]">No setup maze. Arrange a few steps, write the words you want customers to hear, then publish when it feels right.</p></div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { n: '01', title: 'Choose a start', desc: 'Pick the moment a flow should begin.', icon: <Zap size={17} /> },
              { n: '02', title: 'Write the words', desc: 'Add messages and clear next steps.', icon: <MessageSquareText size={17} /> },
              { n: '03', title: 'Put it to work', desc: 'Save changes and publish with confidence.', icon: <ArrowUpRight size={17} /> },
            ].map(step => <article key={step.n} className="rounded-xl border border-[#e1dfd4] bg-[#faf9f3] p-5"><div className="flex items-center justify-between text-[#27745f]"><span>{step.icon}</span><span className="font-mono text-[10px] text-[#98a29a]">{step.n}</span></div><h3 className="mt-8 font-display text-[17px] font-semibold">{step.title}</h3><p className="mt-2 text-[12px] leading-5 text-[#748179]">{step.desc}</p></article>)}
          </div>
        </div>
      </section>
      <section id="built-for-teams" className="mx-auto grid max-w-[1240px] items-center gap-12 px-5 py-16 md:grid-cols-[1fr_.8fr] md:px-10 md:py-24">
        <div className="order-2 rounded-[20px] border border-[#dfe4d9] bg-[#e9eee5] p-6 sm:p-9 md:order-1">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#658077]"><Activity size={14} /> Your workspace, at a glance</div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[#fffefa] p-4"><div className="text-[11px] text-[#748179]">Flows</div><div className="mt-2 font-display text-3xl font-semibold">In one place</div></div>
            <div className="rounded-xl bg-[#fffefa] p-4"><div className="text-[11px] text-[#748179]">Status</div><div className="mt-2 flex items-center gap-2 font-display text-2xl font-semibold"><span className="size-2 rounded-full bg-[#3f9b69]" /> Live or draft</div></div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-[#fffefa] p-4"><span className="text-[12px] font-semibold">Recent updates</span><span className="rounded-md bg-[#edf2e9] px-2 py-1 text-[10px] font-semibold text-[#41705d]">Easy to find</span></div>
        </div>
        <div className="order-1 md:order-2"><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#c66e49]">Made for real work</div><h2 className="font-display mt-4 text-3xl font-semibold tracking-[-.045em] md:text-[42px]">Know what’s live.<br />Change what isn’t.</h2><p className="mt-5 max-w-md text-sm leading-6 text-[#68766f]">A focused home for your team’s conversation flows. Workspace-level access keeps every team’s setup together and gives owners a dependable view of what’s running.</p><Link href="/sign-up" className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#1f6653] hover:text-[#174e40]">Set up your workspace <ArrowRight size={16} /></Link></div>
      </section>
      <section className="mx-auto max-w-[1240px] px-5 pb-16 md:px-10 md:pb-24"><div className="relative overflow-hidden rounded-[22px] bg-[#173c34] px-6 py-10 text-[#f7f4e9] md:px-12 md:py-14"><div className="absolute -right-5 -top-20 size-72 rounded-full border border-[#ffffff12]" /><div className="absolute -right-[-70px] -top-7 size-44 rounded-full border border-[#ffffff1b]" /><div className="relative z-10 flex flex-col justify-between gap-8 md:flex-row md:items-end"><div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#f2a278]">Start with one useful flow</div><h2 className="font-display mt-4 max-w-xl text-3xl font-semibold tracking-[-.04em] md:text-[42px]">Make the next customer conversation a little easier.</h2></div><Link href="/sign-up" className="inline-flex w-fit shrink-0 items-center gap-2 rounded-xl bg-[#f2a278] px-5 py-3.5 text-sm font-bold text-[#183b33] hover:bg-[#f6b38e]">Build your first flow <ArrowRight size={16} /></Link></div></div></section>
    </main>
    <footer className="border-t border-[#e5e2d7] px-5 py-6 md:px-10"><div className="mx-auto flex max-w-[1240px] items-center justify-between"><Logo /><span className="text-[11px] text-[#819087]">A steadier way to handle customer conversations.</span></div></footer>
  </div>;
}

function SignInPage() {
  return <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>;
}
function SignUpPage() {
  return <AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>;
}
function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[#f1f0e8] px-4 py-10"><div className="fixed left-6 top-6"><Link href="/"><Logo /></Link></div><div className="w-full max-w-[440px]">{children}</div></div>;
}

function AuthCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const lastId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const id = user?.id ?? null;
      if (lastId.current !== undefined && lastId.current !== id) client.clear();
      lastId.current = id;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><Home /></Show></>;
}

function Protected({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}

function AppShell({ children, title, eyebrow }: { children: ReactNode; title: string; eyebrow: string }) {
  const [location] = useLocation();
  const { data: user, isLoading, isError, refetch } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey() } });
  const { signOut } = useClerk();
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = [
    { href: '/dashboard', label: 'Overview', icon: <LayoutDashboard size={17} /> },
    { href: '/flows', label: 'Flows', icon: <Workflow size={17} /> },
  ];
  return <div className="app-shell bg-[#f6f5ee] text-[#243832] md:flex">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-[#183b34] px-4 py-5 text-[#f7f4e9] transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between px-2"><Logo light /><button className="md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={19} /></button></div>
      <div className="mt-9 rounded-xl border border-[#ffffff1d] bg-[#ffffff0b] px-3 py-3"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.13em] text-[#a6bcb1]">Workspace</span><ChevronDown size={14} className="text-[#a6bcb1]" /></div><div className="mt-2 truncate text-[13px] font-semibold" data-testid="text-workspace-name">{user?.workspaceName ?? (isLoading ? 'Loading workspace…' : 'Workspace')}</div><div className="mt-0.5 text-[10px] text-[#a6bcb1]">{user?.role ? `${user.role} account` : 'Team space'}</div></div>
      <nav className="mt-8 space-y-1">{links.map(item => {
        const active = location === item.href || location.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} data-testid={`link-nav-${item.label.toLowerCase()}`} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition ${active ? 'bg-[#28584b] text-white' : 'text-[#bdccc3] hover:bg-[#ffffff0b] hover:text-white'}`}>{item.icon}{item.label}{active && <span className="ml-auto size-1.5 rounded-full bg-[#f2a278]" />}</Link>;
      })}</nav>
      <div className="mt-auto">
        <div className="mb-4 rounded-xl border border-[#ffffff16] bg-[#ffffff08] p-3"><div className="flex items-center gap-2 text-[11px] font-semibold"><span className="size-2 rounded-full bg-[#70c18e]" /> Conversation engine</div><div className="mt-1.5 text-[10px] text-[#a6bcb1]">Workspace status is healthy</div></div>
        <div className="flex items-center gap-3 border-t border-[#ffffff1b] px-2 pt-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ed8053] text-xs font-bold text-white">{user?.name?.split(' ').map(x => x[0]).join('').slice(0, 2) || 'CM'}</div>
          <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold" data-testid="text-user-name">{isError ? 'Account unavailable' : user?.name ?? (isLoading ? 'Loading account…' : 'Workspace user')}</div><div className="truncate text-[10px] text-[#a6bcb1]" data-testid="text-user-email">{user?.email ?? ''}</div></div>
          <button type="button" data-testid="button-sign-out" aria-label="Sign out" className="rounded-md p-2 text-[#bdccc3] hover:bg-[#ffffff12] hover:text-white" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut size={16} /></button>
        </div>
        {isError && <button onClick={() => void refetch()} className="ml-2 mt-2 text-[10px] text-[#f2a278]">Retry account details</button>}
      </div>
    </aside>
    {mobileOpen && <button aria-label="Close menu overlay" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-[#14251f]/50 md:hidden" />}
    <div className="min-w-0 flex-1 md:ml-[252px]">
      <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[#e5e4d9] bg-[#f9f8f2]/95 px-5 backdrop-blur md:px-8">
        <div className="flex items-center gap-3"><button type="button" className="rounded-md p-2 hover:bg-[#ecebe2] md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={18} /></button><div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#8a958c]">{eyebrow}</div><h1 className="font-display mt-0.5 text-[16px] font-semibold tracking-[-.025em]">{title}</h1></div></div>
        <div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-full border border-[#dce3d9] bg-[#eef3eb] px-3 py-1.5 text-[10px] font-semibold text-[#43715b] sm:flex"><span className="size-1.5 rounded-full bg-[#3e9c67]" /> All systems operational</div><button type="button" aria-label="Help" className="rounded-lg border border-[#e1e2d8] bg-[#fffefa] p-2 text-[#687a70] hover:text-[#1f6653]"><CircleHelp size={16} /></button></div>
      </header>
      <main className="mx-auto max-w-[1450px] p-5 md:p-8">{children}</main>
    </div>
  </div>;
}

function DashboardPage() {
  const { data, isLoading, isError, refetch } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60000 } });
  return <AppShell title="Overview" eyebrow="Workspace / Overview"><div className="fade-up">
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><div className="text-[11px] font-bold uppercase tracking-[.14em] text-[#ca7950]">Workspace pulse</div><h2 className="font-display mt-2 text-[32px] font-semibold tracking-[-.055em] md:text-[38px]">Good work starts with a clear view.</h2><p className="mt-2 text-sm text-[#718078]">A live snapshot of the flows your team has built.</p></div><Link href="/flows" className="inline-flex items-center gap-2 rounded-lg bg-[#1f6653] px-4 py-2.5 text-[12px] font-bold text-white hover:bg-[#174e40]"><Plus size={15} /> New flow</Link></div>
    {isError ? <ErrorState message="Workspace metrics could not be loaded." retry={() => void refetch()} /> : isLoading ? <MetricSkeleton /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Metric label="Total flows" value={data?.flowCount} description="In this workspace" icon={<Workflow size={17} />} color="green" />
      <Metric label="Published" value={data?.publishedFlowCount} description="Currently live" icon={<Zap size={17} />} color="orange" />
      <Metric label="Flow steps" value={data?.nodeCount} description="Across all flows" icon={<GitBranch size={17} />} color="sage" />
    </div>}
    <div className="mt-8 grid gap-5 xl:grid-cols-[1fr_300px]">
      <section className="overflow-hidden rounded-xl border border-[#e2e2d8] bg-[#fffefa]">
        <div className="flex items-center justify-between border-b border-[#ecece3] px-5 py-4"><div><h3 className="font-display text-[16px] font-semibold">Recent flows</h3><p className="mt-1 text-[11px] text-[#819087]">Pick up where you left off.</p></div><Link href="/flows" className="text-[11px] font-bold text-[#28735f] hover:underline">All flows <ArrowRight className="ml-1 inline" size={13} /></Link></div>
        {isLoading ? <div className="space-y-3 p-5">{[0,1,2].map(n => <div key={n} className="h-[58px] animate-pulse rounded-lg bg-[#f0f1e9]" />)}</div> : isError ? <div className="p-5"><ErrorState message="Recent flows could not be loaded." retry={() => void refetch()} /></div> : !data?.recentFlows?.length ? <EmptyState title="Your first flow starts here." description="Create a conversation flow and it will appear in this workspace view." action={<Link href="/flows" className="rounded-lg bg-[#1f6653] px-4 py-2 text-xs font-bold text-white">Create a flow</Link>} /> : <div className="divide-y divide-[#efefe7]">{data.recentFlows.map(flow => <FlowRow flow={flow} key={flow.id} />)}</div>}
      </section>
      <aside className="space-y-4">
        <div className="rounded-xl border border-[#e2e2d8] bg-[#fffefa] p-5"><div className="flex items-center justify-between"><h3 className="font-display text-[15px] font-semibold">Workspace health</h3><span className={`size-2 rounded-full ${health.data?.status === 'ok' ? 'bg-[#48a36e]' : health.isError ? 'bg-[#d97954]' : 'bg-[#cfaa57]'}`} /></div><p className="mt-2 text-[11px] leading-5 text-[#7a8981]">{health.isLoading ? 'Checking service status…' : health.data?.status ? `Service status: ${health.data.status}.` : 'Service status is currently unavailable.'}</p><div className="mt-4 flex items-center gap-2 border-t border-[#ededdf] pt-3 text-[10px] text-[#819087]"><Activity size={13} /> Updated automatically</div></div>
        <div className="rounded-xl border border-[#ead9c9] bg-[#fff5eb] p-5"><div className="flex items-center gap-2 text-[#bb704a]"><Sparkles size={15} /><span className="text-[10px] font-bold uppercase tracking-[.12em]">A good next step</span></div><p className="mt-3 font-display text-[17px] font-semibold">Keep the first reply simple.</p><p className="mt-2 text-[11px] leading-5 text-[#7f7568]">A clear welcome and two helpful choices can make a conversation easier to navigate.</p><Link href="/flows" className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-[#a85d3b]">Build a flow <ArrowRight size={13} /></Link></div>
      </aside>
    </div>
  </div></AppShell>;
}

function Metric({ label, value, description, icon, color }: { label: string; value?: number; description: string; icon: ReactNode; color: string }) {
  return <article className="rounded-xl border border-[#e2e2d8] bg-[#fffefa] p-5"><div className="flex items-start justify-between"><div><div className="text-[11px] font-semibold text-[#7b8981]">{label}</div><div className="font-display mt-3 text-[34px] font-semibold leading-none tracking-[-.05em]" data-testid={`metric-${label.toLowerCase().replace(' ', '-')}`}>{value ?? '—'}</div></div><span className={`grid size-9 place-items-center rounded-lg ${color === 'green' ? 'bg-[#e6f1e8] text-[#2c7a60]' : color === 'orange' ? 'bg-[#fbede3] text-[#c3704b]' : 'bg-[#eef0e5] text-[#64744f]'}`}>{icon}</span></div><div className="mt-3 text-[10px] text-[#8a958d]">{description}</div></article>;
}
function MetricSkeleton() { return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1,2,3].map(n => <div key={n} className="h-[126px] animate-pulse rounded-xl border border-[#e2e2d8] bg-[#fffefa] p-5"><div className="h-3 w-24 rounded bg-[#e9ebe2]" /><div className="mt-5 h-8 w-16 rounded bg-[#e9ebe2]" /></div>)}</div>; }
function FlowRow({ flow }: { flow: Flow }) {
  return <Link href={`/flows/${flow.id}`} data-testid={`link-flow-${flow.id}`} className="flex items-center gap-3 px-5 py-4 transition hover:bg-[#fafaf4]">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#edf2e9] text-[#32715d]"><MessageSquareText size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold">{flow.name}</span><span className="mt-1 block truncate text-[10px] text-[#859188]">{flow.description || `${flow.graph?.nodes?.length ?? 0} steps · Updated ${formatDate(flow.updatedAt)}`}</span></span><StatusPill status={flow.status} /><ArrowUpRight className="ml-1 text-[#9ca69d]" size={15} />
  </Link>;
}
function StatusPill({ status }: { status: string }) { return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold capitalize ${status === 'published' ? 'bg-[#e7f2e8] text-[#357352]' : 'bg-[#f1f0e9] text-[#7a8177]'}`}>{status}</span>; }
function formatDate(date?: string) { if (!date) return 'recently'; const parsed = new Date(date); return Number.isNaN(parsed.getTime()) ? 'recently' : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="rounded-lg border border-[#efd2c9] bg-[#fff7f3] p-4"><div className="text-[12px] font-semibold text-[#80463a]">{message}</div><button type="button" onClick={retry} className="mt-2 text-[11px] font-bold text-[#a65f47] underline">Try again</button></div>; }
function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="flex flex-col items-start p-8"><span className="grid size-10 place-items-center rounded-xl bg-[#eef3eb] text-[#32715d]"><Workflow size={19} /></span><h3 className="font-display mt-4 text-[17px] font-semibold">{title}</h3><p className="mt-1 max-w-sm text-[12px] leading-5 text-[#7d8981]">{description}</p>{action && <div className="mt-4">{action}</div>}</div>; }

function FlowsPage() {
  const { data: flows, isLoading, isError, refetch } = useListFlows({ query: { queryKey: getListFlowsQueryKey() } });
  const create = useCreateFlow();
  const remove = useDeleteFlow();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate({ data: { name: trimmed, description: description.trim() || null, graph: { nodes: [], edges: [] } } }, {
      onSuccess: flow => {
        void queryClient.invalidateQueries({ queryKey: getListFlowsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setLocation(`/flows/${flow.id}`);
      },
    });
  };
  const onDelete = (flow: Flow) => {
    if (!window.confirm(`Delete “${flow.name}”? This cannot be undone.`)) return;
    remove.mutate({ flowId: flow.id }, { onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getListFlowsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    } });
  };
  return <AppShell title="Flows" eyebrow="Workspace / Flows"><div className="fade-up">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="text-[11px] font-bold uppercase tracking-[.14em] text-[#ca7950]">Conversation library</div><h2 className="font-display mt-2 text-[34px] font-semibold tracking-[-.05em]">Your flows</h2><p className="mt-2 text-sm text-[#718078]">Create and manage the conversations your team runs.</p></div><button type="button" data-testid="button-create-flow" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#1f6653] px-4 py-2.5 text-[12px] font-bold text-white hover:bg-[#174e40]"><Plus size={15} /> Create flow</button></div>
    {create.isError && <div className="mb-4"><ErrorState message="The flow could not be created. Try again." retry={() => setShowCreate(true)} /></div>}
    {remove.isError && <div className="mb-4"><ErrorState message="The flow could not be deleted. Try again." retry={() => void refetch()} /></div>}
    <section className="overflow-hidden rounded-xl border border-[#e2e2d8] bg-[#fffefa]">
      <div className="grid grid-cols-[1fr_130px_132px_48px] items-center border-b border-[#ebebe2] bg-[#fbfaf5] px-5 py-3 text-[9px] font-bold uppercase tracking-[.13em] text-[#89958c]"><span>Flow name</span><span>Status</span><span>Last updated</span><span /></div>
      {isLoading ? <div className="space-y-3 p-5">{[1,2,3].map(n => <div key={n} className="h-12 animate-pulse rounded bg-[#f0f1e9]" />)}</div> : isError ? <div className="p-5"><ErrorState message="Flows could not be loaded." retry={() => void refetch()} /></div> : !flows?.length ? <EmptyState title="A clean slate." description="Start with a flow that welcomes customers or routes a common question." action={<button type="button" onClick={() => setShowCreate(true)} className="rounded-lg bg-[#1f6653] px-4 py-2 text-xs font-bold text-white">Create your first flow</button>} /> : <div className="divide-y divide-[#efefe7]">{flows.map(flow => <div key={flow.id} className="group grid grid-cols-[1fr_130px_132px_48px] items-center px-5 py-3.5 hover:bg-[#fafaf4]">
        <Link href={`/flows/${flow.id}`} className="flex min-w-0 items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#edf2e9] text-[#32715d]"><MessageSquareText size={15} /></span><span className="min-w-0"><span className="block truncate text-[12px] font-semibold">{flow.name}</span><span className="mt-0.5 block truncate text-[10px] text-[#86928a]">{flow.description || `${flow.graph?.nodes?.length ?? 0} steps`}</span></span></Link>
        <div><StatusPill status={flow.status} /></div><div className="text-[10px] text-[#7f8b83]">{formatDate(flow.updatedAt)}</div>
        <button type="button" aria-label={`Delete ${flow.name}`} data-testid={`button-delete-flow-${flow.id}`} onClick={() => onDelete(flow)} disabled={remove.isPending} className="rounded-md p-2 text-[#9da69e] opacity-60 hover:bg-[#fff0ed] hover:text-[#b94f43] group-hover:opacity-100"><Trash2 size={15} /></button>
      </div>)}</div>}
    </section>
    {showCreate && <div className="fixed inset-0 z-50 grid place-items-center bg-[#14251f]/45 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setShowCreate(false); }}><form onSubmit={onCreate} className="w-full max-w-[440px] rounded-2xl border border-[#e3e3d9] bg-[#fffefa] p-6 shadow-2xl">
      <div className="flex items-start justify-between"><div><div className="font-display text-xl font-semibold">Start a new flow</div><p className="mt-1 text-[12px] text-[#7a8981]">Give this conversation a clear name.</p></div><button type="button" aria-label="Close" onClick={() => setShowCreate(false)} className="rounded-md p-1.5 text-[#819087] hover:bg-[#efefe7]"><X size={17} /></button></div>
      <label className="mt-6 block text-[11px] font-bold text-[#53665d]">Flow name<input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="For example, Welcome customers" data-testid="input-flow-name" className="mt-2 w-full rounded-lg border border-[#dfe2d7] bg-[#fbfaf5] px-3 py-2.5 text-sm outline-none focus:border-[#4b8a72] focus:ring-2 focus:ring-[#4b8a72]/15" /></label>
      <label className="mt-4 block text-[11px] font-bold text-[#53665d]">Description <span className="font-normal text-[#96a098]">optional</span><textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={1000} rows={3} placeholder="What does this flow help with?" className="mt-2 w-full resize-none rounded-lg border border-[#dfe2d7] bg-[#fbfaf5] px-3 py-2.5 text-sm outline-none focus:border-[#4b8a72] focus:ring-2 focus:ring-[#4b8a72]/15" /></label>
      {create.isError && <p className="mt-3 text-xs text-[#ae5144]">Could not create this flow. Please try again.</p>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg px-4 py-2.5 text-xs font-bold text-[#69776f] hover:bg-[#f0f0e9]">Cancel</button><button disabled={create.isPending || !name.trim()} data-testid="button-submit-create-flow" className="inline-flex items-center gap-2 rounded-lg bg-[#1f6653] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{create.isPending ? 'Creating…' : 'Create flow'} <ArrowRight size={14} /></button></div>
    </form></div>}
  </div></AppShell>;
}

const nodeTypeLabels: Record<string, string> = { trigger: 'Trigger', message: 'Message', condition: 'Condition' };
const nodeTypeColors: Record<string, string> = { trigger: '#2f8068', message: '#c97751', condition: '#847b47' };
function makeId() { return globalThis.crypto?.randomUUID?.() ?? `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function defaultNode(type: FlowNode['type'], index: number): FlowNode {
  const defaults: Record<FlowNode['type'], FlowNode['data']> = {
    trigger: { label: 'Conversation starts', text: '' },
    message: { label: 'Send a message', text: 'Hi there. How can we help you today?', buttons: [] },
    condition: { label: 'Check a condition', condition: 'Customer has an order question' },
  };
  return { id: makeId(), type, position: { x: 100 + (index % 3) * 260, y: 56 + Math.floor(index / 3) * 210 }, data: defaults[type] };
}

function FlowBuilderPage() {
  const params = useParams<{ flowId: string }>();
  const flowId = params.flowId ?? '';
  const { data: flow, isLoading, isError, refetch } = useGetFlow(flowId, { query: { enabled: !!flowId, queryKey: getGetFlowQueryKey(flowId) } });
  const update = useUpdateFlow();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [graph, setGraph] = useState<FlowGraph>({ nodes: [], edges: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState('');
  const [connectTo, setConnectTo] = useState('');
  const [connectLabel, setConnectLabel] = useState('');
  const [initialized, setInitialized] = useState('');
  const dragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const movedDuringDrag = useRef(false);

  useEffect(() => {
    if (flow && initialized !== flow.id) {
      setName(flow.name);
      setDescription(flow.description ?? '');
      setGraph(flow.graph ?? { nodes: [], edges: [] });
      setSelectedId(flow.graph?.nodes?.[0]?.id ?? null);
      setInitialized(flow.id);
    }
  }, [flow, initialized]);

  const selected = graph.nodes.find(node => node.id === selectedId) ?? null;
  const persist = (status?: 'draft' | 'published') => {
    if (!flow) return;
    const payload = { flowId: flow.id, data: { name: name.trim() || flow.name, description: description.trim() || null, graph, ...(status ? { status } : {}) } };
    update.mutate(payload, { onSuccess: saved => {
      client.setQueryData(getGetFlowQueryKey(flow.id), saved);
      void client.invalidateQueries({ queryKey: getListFlowsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    } });
  };
  const addNode = (type: FlowNode['type']) => {
    const node = defaultNode(type, graph.nodes.length);
    setGraph(current => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(node.id);
  };
  const patchSelected = (patch: Partial<FlowNode['data']>) => {
    if (!selected) return;
    setGraph(current => ({ ...current, nodes: current.nodes.map(node => node.id === selected.id ? { ...node, data: { ...node.data, ...patch } } : node) }));
  };
  const deleteSelected = () => {
    if (!selected) return;
    setGraph(current => ({ nodes: current.nodes.filter(node => node.id !== selected.id), edges: current.edges.filter(edge => edge.source !== selected.id && edge.target !== selected.id) }));
    setSelectedId(null);
  };
  const connectNodes = (event: FormEvent) => {
    event.preventDefault();
    if (!connectFrom || !connectTo || connectFrom === connectTo) return;
    const edge: FlowEdge = { id: makeId(), source: connectFrom, target: connectTo, label: connectLabel.trim() || null };
    setGraph(current => ({ ...current, edges: [...current.edges.filter(item => !(item.source === edge.source && item.target === edge.target)), edge] }));
    setConnectLabel('');
  };
  const updateButton = (index: number, label: string) => {
    const buttons: FlowButton[] = [...(selected?.data.buttons ?? [])];
    buttons[index] = { ...buttons[index], label };
    patchSelected({ buttons });
  };
  const addButton = () => patchSelected({ buttons: [...(selected?.data.buttons ?? []), { label: `Option ${(selected?.data.buttons?.length ?? 0) + 1}`, targetId: null }] });
  const removeButton = (index: number) => patchSelected({ buttons: (selected?.data.buttons ?? []).filter((_, i) => i !== index) });
  const startNodeDrag = (event: ReactPointerEvent<HTMLButtonElement>, node: FlowNode) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(node.id);
    movedDuringDrag.current = false;
    dragRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.position.x,
      originY: node.position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveNodeDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) movedDuringDrag.current = true;
    if (!movedDuringDrag.current) return;
    setGraph(current => ({
      ...current,
      nodes: current.nodes.map(node => node.id === drag.id ? {
        ...node,
        position: {
          x: Math.max(0, drag.originX + deltaX),
          y: Math.max(0, drag.originY + deltaY),
        },
      } : node),
    }));
  };
  const finishNodeDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (isLoading) return <AppShell title="Flow builder" eyebrow="Workspace / Flows"><div className="animate-pulse rounded-xl border border-[#e3e4d9] bg-[#fffefa] p-8"><div className="h-6 w-52 rounded bg-[#e8ebe2]" /><div className="mt-7 h-[420px] rounded-xl bg-[#eef0e8]" /></div></AppShell>;
  if (isError || !flow) return <AppShell title="Flow builder" eyebrow="Workspace / Flows"><ErrorState message="This flow could not be loaded." retry={() => void refetch()} /></AppShell>;

  return <AppShell title={name || 'Flow builder'} eyebrow="Workspace / Flows">
    <div className="fade-up">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><Link href="/flows" className="rounded-lg border border-[#e1e2d8] bg-[#fffefa] p-2 text-[#66776e] hover:text-[#1f6653]"><ArrowDown size={15} className="rotate-90" /></Link><div className="min-w-0"><input value={name} onChange={event => setName(event.target.value)} maxLength={120} data-testid="input-builder-flow-name" className="max-w-[420px] truncate border-0 bg-transparent p-0 font-display text-[22px] font-semibold tracking-[-.04em] outline-none focus:ring-0 md:text-[26px]" /><div className="mt-1 flex items-center gap-2 text-[10px] text-[#819087]"><StatusPill status={flow.status} /> <span>Last updated {formatDate(flow.updatedAt)}</span></div></div></div>
        <div className="flex items-center gap-2"><span className="hidden text-[10px] text-[#819087] sm:inline">{update.isSuccess ? 'All changes saved' : update.isPending ? 'Saving changes…' : ''}</span><button type="button" data-testid="button-save-flow" disabled={update.isPending} onClick={() => persist()} className="inline-flex items-center gap-2 rounded-lg border border-[#d9e0d6] bg-[#fffefa] px-3.5 py-2.5 text-[11px] font-bold text-[#35584b] hover:bg-[#f1f4ed] disabled:opacity-60"><Save size={14} /> Save</button><button type="button" data-testid="button-publish-flow" disabled={update.isPending} onClick={() => persist(flow.status === 'published' ? 'draft' : 'published')} className="inline-flex items-center gap-2 rounded-lg bg-[#1f6653] px-3.5 py-2.5 text-[11px] font-bold text-white hover:bg-[#174e40] disabled:opacity-60"><Zap size={14} /> {flow.status === 'published' ? 'Unpublish' : 'Publish'}</button></div>
      </div>
      {update.isError && <div className="mb-4"><ErrorState message="Your changes could not be saved. Check your connection and try again." retry={() => persist()} /></div>}
      <div className="grid overflow-hidden rounded-xl border border-[#dcdfd5] bg-[#fffefa] xl:grid-cols-[1fr_310px]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e9eae1] px-4 py-3">
            <div><div className="font-display text-[13px] font-semibold">Conversation map</div><div className="mt-0.5 text-[10px] text-[#89948d]">{graph.nodes.length} {graph.nodes.length === 1 ? 'step' : 'steps'} · {graph.edges.length} connections</div></div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" data-testid="button-add-trigger" onClick={() => addNode(FlowNodeType.trigger)} className="inline-flex items-center gap-1.5 rounded-md border border-[#dce6dd] bg-[#f6faf5] px-2.5 py-1.5 text-[10px] font-bold text-[#32745d] hover:bg-[#eaf3e9]"><Plus size={12} /> Trigger</button>
              <button type="button" data-testid="button-add-message" onClick={() => addNode(FlowNodeType.message)} className="inline-flex items-center gap-1.5 rounded-md border border-[#ecdccd] bg-[#fff8f1] px-2.5 py-1.5 text-[10px] font-bold text-[#b66a48] hover:bg-[#f9eee3]"><Plus size={12} /> Message</button>
              <button type="button" data-testid="button-add-condition" onClick={() => addNode(FlowNodeType.condition)} className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e3ce] bg-[#faf9ed] px-2.5 py-1.5 text-[10px] font-bold text-[#827844] hover:bg-[#f3f0d9]"><Plus size={12} /> Condition</button>
            </div>
          </div>
          <div className="canvas-grid relative min-h-[480px] overflow-auto p-5 md:min-h-[620px]">
            {graph.nodes.length === 0 ? <div className="mx-auto mt-16 max-w-sm rounded-xl border border-dashed border-[#bcc9ba] bg-[#fffefa]/90 p-7 text-center"><span className="mx-auto grid size-10 place-items-center rounded-xl bg-[#eaf2e9] text-[#32745d]"><Workflow size={19} /></span><h3 className="font-display mt-4 text-[16px] font-semibold">Give the conversation a starting point.</h3><p className="mt-2 text-[11px] leading-5 text-[#7b8981]">Add a trigger, then place messages or conditions wherever they make sense.</p><button type="button" onClick={() => addNode(FlowNodeType.trigger)} className="mt-4 rounded-lg bg-[#1f6653] px-4 py-2 text-[11px] font-bold text-white">Add a trigger</button></div> : <div className="relative min-h-[440px] min-w-[720px]">
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-label="Flow connections">
                {graph.edges.map(edge => {
                  const a = graph.nodes.find(n => n.id === edge.source); const b = graph.nodes.find(n => n.id === edge.target);
                  if (!a || !b) return null;
                  const x1 = a.position.x + 196; const y1 = a.position.y + 90; const x2 = b.position.x; const y2 = b.position.y + 90;
                  const mid = (x1 + x2) / 2;
                  return <g key={edge.id}><path d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" stroke="#84a394" strokeWidth="2" strokeDasharray="5 4" /><circle cx={x2} cy={y2} r="4" fill="#5d8b75" />{edge.label && <text x={mid} y={(y1 + y2) / 2 - 8} textAnchor="middle" fill="#71847a" fontSize="10">{edge.label}</text>}</g>;
                })}
              </svg>
              {graph.nodes.map((node, index) => <button key={node.id} type="button" onClick={() => setSelectedId(node.id)} onPointerDown={event => startNodeDrag(event, node)} onPointerMove={moveNodeDrag} onPointerUp={finishNodeDrag} onPointerCancel={finishNodeDrag} data-testid={`node-${node.id}`} aria-label={`${nodeTypeLabels[node.type]} step: ${node.data.label}. Drag to reposition.`} className={`node-card absolute w-[204px] touch-none select-none cursor-grab rounded-xl border bg-[#fffefa] p-3 text-left active:cursor-grabbing ${selectedId === node.id ? 'ring-2 ring-[#2f8068]/35' : ''}`} style={{ left: node.position.x, top: node.position.y, borderColor: selectedId === node.id ? '#66a188' : '#dfe3d8' }}>
                <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.1em]" style={{ color: nodeTypeColors[node.type] }}>{node.type === 'trigger' ? <Zap size={12} /> : node.type === 'message' ? <MessageSquareText size={12} /> : <GitBranch size={12} />}{nodeTypeLabels[node.type]}</span><MoreHorizontal size={14} className="text-[#a4aea5]" /></div>
                <div className="mt-2 text-[11px] font-semibold text-[#293e36]">{node.data.label}</div>
                <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#76847b]">{node.type === 'condition' ? node.data.condition || 'Set a condition' : node.data.text || (node.type === 'trigger' ? 'Starts this conversation' : 'Add your message')}</div>
                {node.data.buttons?.map(button => <div key={button.label} className="mt-1 rounded border border-[#e4e7de] px-1.5 py-1 text-[9px] text-[#7b8980]">{button.label}</div>)}
                <span className="absolute -right-[5px] top-[84px] size-2.5 rounded-full border-2 border-[#fffefa] bg-[#6f9b82]" />
                {index !== 0 && <span className="absolute -left-[5px] top-[84px] size-2.5 rounded-full border-2 border-[#fffefa] bg-[#6f9b82]" />}
              </button>)}
            </div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e9eae1] bg-[#fbfaf5] px-4 py-2.5 text-[10px] text-[#849188]"><span className="flex items-center gap-1.5"><Command size={12} /> Select a step to edit · connect steps in the right panel</span><span className="flex items-center gap-1"><Check size={12} className="text-[#438466]" /> Changes are saved when you choose Save</span></div>
        </section>
        <aside className="border-t border-[#e8e9df] bg-[#fffefa] xl:border-l xl:border-t-0">
          {selected ? <div className="p-5">
            <div className="flex items-center justify-between"><div><div className="text-[9px] font-bold uppercase tracking-[.13em]" style={{ color: nodeTypeColors[selected.type] }}>{nodeTypeLabels[selected.type]} step</div><h3 className="font-display mt-1 text-[16px] font-semibold">Step details</h3></div><button type="button" data-testid="button-remove-node" aria-label="Delete selected step" onClick={deleteSelected} className="rounded-md p-2 text-[#9b837c] hover:bg-[#fff0eb] hover:text-[#b84c41]"><Trash2 size={15} /></button></div>
            <label className="mt-5 block text-[10px] font-bold text-[#586a60]">Step name<input value={selected.data.label} onChange={event => patchSelected({ label: event.target.value })} maxLength={120} data-testid="input-node-label" className="mt-1.5 w-full rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2.5 py-2 text-[11px] font-normal outline-none focus:border-[#4b8a72]" /></label>
            {selected.type === 'message' && <>
              <label className="mt-4 block text-[10px] font-bold text-[#586a60]">Message text<textarea value={selected.data.text ?? ''} onChange={event => patchSelected({ text: event.target.value })} maxLength={2000} rows={5} data-testid="input-node-message" placeholder="Write the message your customer will see." className="mt-1.5 w-full resize-y rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2.5 py-2 text-[11px] font-normal leading-5 outline-none focus:border-[#4b8a72]" /></label>
              <div className="mt-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold text-[#586a60]">Reply buttons</span><span className="text-[9px] text-[#99a39a]">{selected.data.buttons?.length ?? 0}/5</span></div>{(selected.data.buttons ?? []).map((button, index) => <div key={`${selected.id}-button-${index}`} className="mt-2 flex gap-1"><input value={button.label} maxLength={80} onChange={event => updateButton(index, event.target.value)} data-testid={`input-node-button-${index}`} className="min-w-0 flex-1 rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2.5 py-2 text-[10px] outline-none focus:border-[#4b8a72]" /><button type="button" aria-label={`Remove reply button ${index + 1}`} onClick={() => removeButton(index)} className="rounded-md p-2 text-[#99a39a] hover:bg-[#fff0eb] hover:text-[#b84c41]"><X size={13} /></button></div>)}{(selected.data.buttons?.length ?? 0) < 5 && <button type="button" data-testid="button-add-reply" onClick={addButton} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[#32745d] hover:underline"><Plus size={12} /> Add reply button</button>}</div>
            </>}
            {selected.type === 'condition' && <label className="mt-4 block text-[10px] font-bold text-[#586a60]">Condition to check<textarea value={selected.data.condition ?? ''} onChange={event => patchSelected({ condition: event.target.value })} maxLength={500} rows={4} placeholder="Describe the condition this step checks." className="mt-1.5 w-full resize-y rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2.5 py-2 text-[11px] font-normal leading-5 outline-none focus:border-[#4b8a72]" /></label>}
            {selected.type === 'trigger' && <div className="mt-4 rounded-lg border border-[#e3e9df] bg-[#f5f8f1] p-3 text-[10px] leading-5 text-[#718078]">This flow begins when a conversation starts. More trigger options can be added as your setup grows.</div>}
            <div className="my-5 border-t border-[#ecece3]" />
            <form onSubmit={connectNodes}>
              <div className="flex items-center gap-2"><GitBranch size={14} className="text-[#678877]" /><h4 className="text-[11px] font-bold">Connect a step</h4></div>
              <p className="mt-1 text-[10px] leading-4 text-[#88948c]">Choose where this step leads.</p>
              <label className="mt-3 block text-[9px] font-bold text-[#64736a]">From<select value={connectFrom || selected.id} onChange={event => setConnectFrom(event.target.value)} className="mt-1 w-full rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2 py-2 text-[10px] font-normal"><option value={selected.id}>{selected.data.label}</option>{graph.nodes.filter(node => node.id !== selected.id).map(node => <option key={node.id} value={node.id}>{node.data.label}</option>)}</select></label>
              <label className="mt-2 block text-[9px] font-bold text-[#64736a]">To<select value={connectTo} onChange={event => setConnectTo(event.target.value)} required className="mt-1 w-full rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2 py-2 text-[10px] font-normal"><option value="">Choose a step…</option>{graph.nodes.filter(node => node.id !== (connectFrom || selected.id)).map(node => <option key={node.id} value={node.id}>{node.data.label}</option>)}</select></label>
              <input value={connectLabel} onChange={event => setConnectLabel(event.target.value)} maxLength={120} placeholder="Optional connection label" className="mt-2 w-full rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2 py-2 text-[10px] outline-none focus:border-[#4b8a72]" />
              <button type="submit" disabled={!connectTo || graph.nodes.length < 2} data-testid="button-connect-nodes" className="mt-2 w-full rounded-md border border-[#dce5dc] bg-[#eff5ed] px-3 py-2 text-[10px] font-bold text-[#39715d] disabled:opacity-50">Add connection</button>
            </form>
            {graph.edges.length > 0 && <div className="mt-4 space-y-1.5">{graph.edges.map(edge => <div key={edge.id} className="flex items-center gap-2 rounded-md bg-[#f6f6f0] px-2.5 py-2 text-[9px] text-[#77857c]"><span className="truncate">{graph.nodes.find(n => n.id === edge.source)?.data.label}</span><ArrowRight size={11} className="shrink-0" /><span className="truncate flex-1">{graph.nodes.find(n => n.id === edge.target)?.data.label}</span>{edge.label && <span className="max-w-16 truncate rounded bg-[#e9eee7] px-1.5 py-0.5">{edge.label}</span>}<button type="button" aria-label="Remove connection" onClick={() => setGraph(current => ({ ...current, edges: current.edges.filter(item => item.id !== edge.id) }))} className="text-[#99a39a] hover:text-[#b84c41]"><X size={12} /></button></div>)}</div>}
          </div> : <div className="p-6"><div className="grid size-9 place-items-center rounded-lg bg-[#edf2e9] text-[#32745d]"><Settings2 size={17} /></div><h3 className="font-display mt-4 text-[15px] font-semibold">Edit your flow</h3><p className="mt-2 text-[11px] leading-5 text-[#7f8c84]">Select a step to update its content, or add a new step from the toolbar.</p><label className="mt-5 block text-[10px] font-bold text-[#586a60]">Flow description<textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={1000} placeholder="What does this flow help with?" className="mt-1.5 w-full resize-none rounded-md border border-[#dfe2d7] bg-[#fbfaf5] px-2.5 py-2 text-[11px] font-normal outline-none focus:border-[#4b8a72]" /></label></div>}
        </aside>
      </div>
    </div>
  </AppShell>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to manage your workspace.' } }, signUp: { start: { title: 'Create your workspace', subtitle: 'Get your conversation flows moving.' } } }}
    routerPush={(to: string) => setLocation(stripBase(to))}
    routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}
  >
    <AuthCacheInvalidator />
    <RoutedErrorBoundary><Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard"><Protected><DashboardPage /></Protected></Route>
      <Route path="/flows"><Protected><FlowsPage /></Protected></Route>
      <Route path="/flows/:flowId"><Protected><FlowBuilderPage /></Protected></Route>
      <Route component={NotFound} />
    </Switch></RoutedErrorBoundary>
  </ClerkProvider>;
}

function App() {
  if (!clerkPubKey) {
    return <div className="grid min-h-[100dvh] place-items-center bg-[#f6f5ee] p-8 text-center text-sm text-[#53665d]">Authentication is not configured yet. Add the Clerk publishable key to continue.</div>;
  }
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ClerkRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
