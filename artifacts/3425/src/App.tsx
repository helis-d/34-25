import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import {
  ArrowUp, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Copy, Edit3, ExternalLink,
  Flag, Home, LogIn, LogOut, Menu, MessageSquare, Moon, PenLine, Plus, Search, Send,
  Settings2, ShieldAlert, Sun, Trash2, X, Zap,
} from 'lucide-react';
import {
  getGetCommentsQueryKey, getGetCurrentUserQueryKey, getGetFeedQueryKey, getGetPostQueryKey,
  getGetProfileQueryKey, getSearchQueryKey, PostInputType, ReportInputReason,
  ReportInputTargetType, useCreateComment, useCreatePost, useCreateReport, useDeleteComment,
  useDeletePost, useGetComments, useGetCurrentUser, useGetFeed, useGetPost, useGetProfile,
  useLogIn, useLogOut, useRequestUploadUrl, useSearch, useSignUp, useUpdateComment,
  useUpdatePost, useVoteOnComment, useVoteOnPost,
  type Comment, type Post, type PostListItem, type PostInputType as PostKind,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import type { PostListItemType } from '@workspace/api-client-react';

const queryClient = new QueryClient();

function timeAgo(value: string) {
  const delta = Math.max(1, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(delta / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function typeLabel(type: PostListItemType) {
  return type === 'ask' ? 'ASK' : type === 'show' ? 'SHOW' : 'DISCUSS';
}

function humanError(error: unknown) {
  if (error && typeof error === 'object' && 'error' in error) return String((error as { error: unknown }).error);
  return 'Something went wrong. Please try again.';
}

function MarkdownContent({ content }: { content: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const chunks = useMemo(() => content.split(/(```[\s\S]*?```)/g), [content]);
  const copy = async (code: string, id: string) => {
    await navigator.clipboard?.writeText(code);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1600);
  };
  return (
    <div className="space-y-4 text-[15px] leading-7 text-foreground/90" data-testid="content-markdown">
      {chunks.map((chunk, index) => {
        if (chunk.startsWith('```')) {
          const lines = chunk.slice(3, -3).replace(/^\w+\n/, '');
          const id = `code-${index}`;
          return (
            <div className="relative overflow-hidden border border-border bg-foreground/[.045]" key={id}>
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
                <span className="mono">code</span>
                <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => copy(lines, id)} data-testid={`button-copy-code-${index}`}>
                  {copied === id ? <Check size={13} /> : <Copy size={13} />}
                  {copied === id ? 'copied' : 'copy'}
                </button>
              </div>
              <pre className="overflow-x-auto p-4 text-[13px] leading-6"><code className="mono">{lines}</code></pre>
            </div>
          );
        }
        return chunk.split(/\n\n+/).filter(Boolean).map((paragraph, paragraphIndex) => (
          <p key={`${index}-${paragraphIndex}`} className="whitespace-pre-wrap">
            {paragraph.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, partIndex) => {
              if (part.startsWith('**') && part.endsWith('**')) return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
              if (part.startsWith('`') && part.endsWith('`')) return <code key={partIndex} className="mono rounded bg-muted px-1.5 py-0.5 text-[13px]">{part.slice(1, -1)}</code>;
              return part;
            })}
          </p>
        ));
      })}
    </div>
  );
}

function Avatar({ username, size = 'sm' }: { username: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center border border-primary/25 bg-primary/10 font-semibold text-primary ${size === 'lg' ? 'h-12 w-12 text-sm' : 'h-7 w-7 text-[10px]'}`} data-testid={`avatar-${username}`}>
      {initials(username)}
    </span>
  );
}

function LoadingRows({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y divide-border border-y border-border" data-testid="status-loading">
      {Array.from({ length: count }).map((_, index) => (
        <div className="flex gap-4 px-3 py-5" key={index}>
          <div className="h-8 w-8 animate-pulse bg-muted" />
          <div className="flex-1 space-y-2"><div className="h-4 w-2/3 animate-pulse bg-muted" /><div className="h-3 w-1/3 animate-pulse bg-muted" /></div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, retry }: { message?: string; retry?: () => void }) {
  return (
    <div className="border border-destructive/30 bg-destructive/5 px-5 py-8 text-center" data-testid="status-error">
      <ShieldAlert className="mx-auto mb-3 text-destructive" size={20} />
      <p className="text-sm">{message || 'The signal dropped before this loaded.'}</p>
      {retry && <button className="mt-4 border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={retry} type="button" data-testid="button-retry">Try again</button>}
    </div>
  );
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-border px-6 py-14 text-center" data-testid="status-empty">
      <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center border border-border bg-muted/40 text-primary"><Zap size={16} /></div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{copy}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function VoteButton({ item, onVoted }: { item: Pick<PostListItem, 'id' | 'score' | 'userVoted'>; onVoted?: (score: number, voted: boolean) => void }) {
  const vote = useVoteOnPost();
  const [score, setScore] = useState(item.score);
  const [voted, setVoted] = useState(Boolean(item.userVoted));
  const handleVote = () => vote.mutate({ postId: item.id }, {
    onSuccess: (result) => { setScore(result.score); setVoted(result.voted); onVoted?.(result.score, result.voted); },
  });
  return (
    <button type="button" aria-label={voted ? 'Remove upvote' : 'Upvote post'} onClick={handleVote} disabled={vote.isPending} className={`group flex min-w-12 flex-col items-center gap-0.5 py-1 text-xs ${voted ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`} data-testid={`button-vote-post-${item.id}`}>
      <ArrowUp size={16} strokeWidth={voted ? 2.5 : 1.8} />
      <span className="mono text-[11px]">{score}</span>
    </button>
  );
}

function PostCard({ item }: { item: PostListItem }) {
  return (
    <article className="group flex gap-3 border-b border-border px-3 py-4 transition-colors hover:bg-muted/25 sm:gap-4" data-testid={`card-post-${item.id}`}>
      <VoteButton item={item} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold tracking-[.13em] text-accent">
          <span>{typeLabel(item.type)}</span><span className="h-px w-4 bg-accent/40" />
        </div>
        <Link href={`/p/${item.id}`} className="block truncate text-[15px] font-semibold leading-6 text-foreground hover:text-primary sm:text-base" data-testid={`link-post-${item.id}`}>{item.title}</Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Link href={`/u/${item.author.username}`} className="font-medium text-foreground/70 hover:text-primary" data-testid={`link-author-${item.id}`}>{item.author.username}</Link>
          <span>·</span><span>{timeAgo(item.createdAt)}</span><span>·</span>
          <Link href={`/p/${item.id}#discussion`} className="hover:text-foreground" data-testid={`link-comments-${item.id}`}>{item.commentCount} {item.commentCount === 1 ? 'comment' : 'comments'}</Link>
          {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary" data-testid={`link-external-${item.id}`}><ExternalLink size={11} /> link</a>}
        </div>
      </div>
    </article>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: current } = useGetCurrentUser();
  const logout = useLogOut();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('3425-theme') as 'light' | 'dark') || 'light');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('3425-theme', theme);
  }, [theme]);
  const doSearch = (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (term.length >= 2) { setLocation(`/search?q=${encodeURIComponent(term)}`); setMobileOpen(false); }
  };
  const nav = [
    { href: '/', label: 'top', icon: Home },
    { href: '/new', label: 'new', icon: Zap },
    { href: '/ask', label: 'ask', icon: CircleHelp },
    { href: '/show', label: 'show', icon: Code2 },
  ];
  return (
    <div className="app-noise min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-3 px-4 sm:px-6">
          <button type="button" className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle navigation" data-testid="button-toggle-navigation"><Menu size={18} /></button>
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)} data-testid="link-home">
            <span className="flex h-8 w-8 items-center justify-center bg-primary text-sm font-bold text-primary-foreground">34</span>
            <span className="mono hidden text-sm font-medium tracking-[.08em] sm:inline">3425</span>
          </Link>
          <form onSubmit={doSearch} className="relative ml-2 max-w-[380px] flex-1 sm:ml-6" role="search">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="search discussions" className="h-9 w-full border border-border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary" data-testid="input-search" />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} data-testid="button-theme-toggle">{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>
            {current?.user ? (
              <>
                <Link href={`/u/${current.user.username}`} className="hidden items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted sm:flex" data-testid="link-current-profile"><Avatar username={current.user.username} /><span>{current.user.username}</span></Link>
                <button type="button" className="hidden h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground sm:inline-flex" onClick={() => logout.mutate(undefined, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }) })} aria-label="Log out" data-testid="button-logout"><LogOut size={15} /></button>
              </>
            ) : <Link href="/login" className="border border-border px-3 py-1.5 text-xs font-semibold hover:border-primary hover:text-primary" data-testid="link-login">sign in</Link>}
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1240px]">
        <aside className={`${mobileOpen ? 'block' : 'hidden'} absolute inset-x-0 top-14 z-30 border-b border-border bg-sidebar p-4 md:relative md:top-0 md:block md:w-52 md:shrink-0 md:border-b-0 md:border-r md:bg-transparent md:p-6 md:pr-5`} aria-label="Primary navigation">
          <nav className="space-y-1">
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">read / make</p>
            {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 px-3 py-2 text-sm ${location === href ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`} data-testid={`link-nav-${label}`}><Icon size={15} /><span>{label}</span>{href === '/' && <span className="mono ml-auto text-[10px] text-muted-foreground">01</span>}</Link>)}
            <Link href="/new" onClick={() => setMobileOpen(false)} className="mt-4 flex items-center justify-center gap-2 bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90" data-testid="link-create-post"><Plus size={15} /> new post</Link>
          </nav>
          <div className="mt-12 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
            <p className="mono mb-2 text-[10px] text-primary">/ quiet signal</p>
            <p>3425 is a small room for useful ideas, honest questions, and things worth showing.</p>
          </div>
          <div className="mt-6 flex items-center gap-3 px-3 text-xs text-muted-foreground">
            <Settings2 size={14} /><span>moderated by people</span>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-9">{children}</main>
      </div>
    </div>
  );
}

function FeedPage({ section }: { section?: 'top' | 'new' | 'ask' | 'show' }) {
  const [page, setPage] = useState(1);
  const params = useMemo(() => ({ section, page, pageSize: 30 }), [section, page]);
  const feed = useGetFeed(params);
  const title = section === 'ask' ? 'Questions, without the performance.' : section === 'show' ? 'Things made in the open.' : section === 'new' ? 'The latest signal.' : 'A quiet front page for useful ideas.';
  const intro = section === 'top' || !section ? 'TOP / 3425' : `${section.toUpperCase()} / 3425`;
  return (
    <div className="fade-in mx-auto max-w-[860px]">
      <div className="mb-8 flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div><p className="mono mb-3 text-[11px] font-medium tracking-[.18em] text-accent">{intro}</p><h1 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 text-sm text-muted-foreground">No engagement tricks. Just good threads, ordered by signal.</p></div>
        <div className="mono flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 bg-primary" /> live index</div>
      </div>
      {feed.isLoading ? <LoadingRows /> : feed.isError ? <ErrorState message={humanError(feed.error)} retry={() => feed.refetch()} /> : !feed.data?.items?.length ? <EmptyState title="Nothing here yet." copy="The first useful thread in this corner can be yours." action={<Link href="/new" className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="link-empty-create"><PenLine size={14} /> start a thread</Link>} /> : <><div className="border-t border-border">{feed.data.items.map((item) => <PostCard key={item.id} item={item} />)}</div>{feed.data.hasMore && <button type="button" onClick={() => setPage(page + 1)} className="mt-5 flex w-full items-center justify-center gap-2 border border-border py-2.5 text-sm font-medium hover:bg-muted" data-testid="button-load-more">load more <ChevronDown size={14} /></button>}</>}
      <footer className="mt-14 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5 text-xs text-muted-foreground"><span>good conversations compound</span><span>·</span><span className="mono">v0.1 / 3425</span></footer>
    </div>
  );
}

function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const [, setLocation] = useLocation();
  const query = useQueryClient();
  const login = useLogIn();
  const signup = useSignUp();
  const [values, setValues] = useState({ username: '', email: '', password: '' });
  const mutation = mode === 'login' ? login : signup;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'login') login.mutate({ data: { email: values.email, password: values.password } }, { onSuccess: () => { query.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/'); } });
    else signup.mutate({ data: values }, { onSuccess: () => { query.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/'); } });
  };
  return (
    <div className="fade-in mx-auto max-w-[480px] py-8 sm:py-16">
      <div className="mb-8"><p className="mono mb-3 text-[11px] tracking-[.18em] text-accent">MEMBER ACCESS</p><h1 className="text-3xl font-semibold tracking-tight">{mode === 'login' ? 'Welcome back.' : 'Make a little room.'}</h1><p className="mt-2 text-sm text-muted-foreground">{mode === 'login' ? 'Pick up where you left off.' : 'A username, a working email, and a curious mind.'}</p></div>
      <form onSubmit={submit} className="space-y-4 border-y border-border py-6" data-testid={`form-${mode}`}>
        {mode === 'signup' && <label className="block"><span className="mb-1.5 block text-xs font-medium">username</span><input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]+" value={values.username} onChange={(e) => setValues({ ...values, username: e.target.value })} className="h-10 w-full border border-input bg-card px-3 text-sm" data-testid="input-username" /></label>}
        <label className="block"><span className="mb-1.5 block text-xs font-medium">email</span><input required type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} className="h-10 w-full border border-input bg-card px-3 text-sm" data-testid="input-email" /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-medium">password</span><input required minLength={mode === 'signup' ? 8 : 1} type="password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} className="h-10 w-full border border-input bg-card px-3 text-sm" data-testid="input-password" /></label>
        {mutation.isError && <p className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="status-auth-error">{humanError(mutation.error)}</p>}
        <button type="submit" disabled={mutation.isPending} className="flex h-10 w-full items-center justify-center gap-2 bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-submit-auth">{mutation.isPending ? 'checking…' : mode === 'login' ? 'sign in' : 'create account'} <ChevronRight size={15} /></button>
      </form>
      <p className="mt-5 text-sm text-muted-foreground">{mode === 'login' ? 'New here? ' : 'Already have an account? '}<Link href={mode === 'login' ? '/signup' : '/login'} className="font-semibold text-primary hover:underline" data-testid="link-switch-auth">{mode === 'login' ? 'create an account' : 'sign in'}</Link></p>
    </div>
  );
}

function CreatePage() {
  const [, setLocation] = useLocation();
  const query = useQueryClient();
  const { data: current } = useGetCurrentUser();
  const create = useCreatePost();
  const upload = useRequestUploadUrl();
  const [kind, setKind] = useState<PostKind>('discuss');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  if (!current?.user) return <EmptyState title="Sign in to write." copy="3425 keeps authorship attached to every useful thread." action={<Link href="/login" className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="link-create-login"><LogIn size={14} /> sign in</Link>} />;
  const handleFile = async (file: File) => {
    setUploading(true);
    upload.mutate({ data: { name: file.name, size: file.size, contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' } }, {
      onSuccess: async (result) => {
        await fetch(result.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        setMediaPath(result.objectPath); setUploading(false);
      },
      onError: () => setUploading(false),
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ data: { type: kind === 'discuss' ? PostInputType.discuss : kind === 'ask' ? PostInputType.ask : PostInputType.show, title: title.trim(), content, url: url.trim() || null, mediaPath } }, {
      onSuccess: (post) => { query.invalidateQueries({ queryKey: getGetFeedQueryKey() }); setLocation(`/p/${post.id}`); },
    });
  };
  return (
    <div className="fade-in mx-auto max-w-[800px]">
      <div className="mb-8 border-b border-border pb-6"><p className="mono mb-3 text-[11px] tracking-[.18em] text-accent">NEW THREAD / 3425</p><h1 className="text-3xl font-semibold tracking-tight">Put something into the room.</h1><p className="mt-2 text-sm text-muted-foreground">Short title, clear context. Markdown is welcome.</p></div>
      <form onSubmit={submit} className="space-y-5" data-testid="form-create-post">
        <div className="grid grid-cols-3 border border-border" role="radiogroup" aria-label="Post type">{(['discuss', 'ask', 'show'] as const).map((value) => <button type="button" key={value} onClick={() => setKind(value)} className={`flex items-center justify-center gap-2 border-r border-border px-3 py-2.5 text-xs font-semibold last:border-r-0 ${kind === value ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`} aria-pressed={kind === value} data-testid={`button-type-${value}`}>{value === 'ask' ? <CircleHelp size={14} /> : value === 'show' ? <Code2 size={14} /> : <MessageSquare size={14} />}{value}</button>)}</div>
        <label className="block"><span className="mb-2 block text-xs font-medium">title</span><input required minLength={3} maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A title that makes someone curious" className="h-11 w-full border border-input bg-card px-3 text-base" data-testid="input-post-title" /></label>
        <label className="block"><span className="mb-2 block text-xs font-medium">context <span className="font-normal text-muted-foreground">/ markdown</span></span><textarea required maxLength={50000} value={content} onChange={(e) => setContent(e.target.value)} placeholder={kind === 'ask' ? 'What are you trying to understand?' : 'What should people know before they respond?'} className="min-h-[260px] w-full resize-y border border-input bg-card p-3 text-[15px] leading-7" data-testid="textarea-post-content" /></label>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]"><label className="block"><span className="mb-2 block text-xs font-medium">link <span className="font-normal text-muted-foreground">/ optional</span></span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className="h-10 w-full border border-input bg-card px-3 text-sm" data-testid="input-post-url" /></label><label className="block"><span className="mb-2 block text-xs font-medium">image</span><span className="flex h-10 cursor-pointer items-center gap-2 border border-input bg-card px-3 text-xs text-muted-foreground hover:bg-muted"><Plus size={14} />{uploading ? 'uploading…' : mediaPath ? 'attached' : 'attach'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} data-testid="input-post-image" /></span></label></div>
        {create.isError && <p className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="status-create-error">{humanError(create.error)}</p>}
        <div className="flex items-center justify-between border-t border-border pt-5"><span className="text-xs text-muted-foreground">{content.length.toLocaleString()} / 50,000</span><button disabled={create.isPending || uploading || title.trim().length < 3 || !content.trim()} type="submit" className="inline-flex items-center gap-2 bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-submit-post">{create.isPending ? 'publishing…' : 'publish thread'} <Send size={14} /></button></div>
      </form>
    </div>
  );
}

function CommentRow({ comment, postId, onReply, canManage }: { comment: Comment; postId: string; onReply: (comment: Comment) => void; canManage: boolean }) {
  const query = useQueryClient();
  const update = useUpdateComment();
  const remove = useDeleteComment();
  const vote = useVoteOnComment();
  const report = useCreateReport();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.content);
  const [score, setScore] = useState(comment.score);
  const [voted, setVoted] = useState(comment.userVoted);
  const [reported, setReported] = useState(false);
  const save = () => update.mutate({ commentId: comment.id, data: { content: text.trim() } }, { onSuccess: (updated) => { setEditing(false); query.setQueryData(getGetCommentsQueryKey(postId), (old: Comment[] | undefined) => old?.map((item) => item.id === updated.id ? updated : item)); } });
  return (
    <div className="relative border-l border-border py-4 pl-4 sm:pl-5" style={{ marginLeft: Math.min(comment.depth * 16, 80) }} data-testid={`comment-${comment.id}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Link href={`/u/${comment.author.username}`} className="font-semibold text-foreground/80 hover:text-primary" data-testid={`link-comment-author-${comment.id}`}>{comment.author.username}</Link><span>·</span><span>{timeAgo(comment.createdAt)}</span>{comment.updatedAt !== comment.createdAt && <span className="mono text-[10px]">(edited)</span>}</div>
      {comment.deleted ? <p className="text-sm italic text-muted-foreground">[comment removed]</p> : editing ? <div className="space-y-2"><textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-24 w-full border border-input bg-card p-3 text-sm leading-6" data-testid={`textarea-edit-comment-${comment.id}`} /><div className="flex gap-2"><button type="button" onClick={save} disabled={update.isPending || !text.trim()} className="bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground" data-testid={`button-save-comment-${comment.id}`}>save</button><button type="button" onClick={() => setEditing(false)} className="border border-border px-3 py-1.5 text-xs" data-testid={`button-cancel-comment-${comment.id}`}>cancel</button></div></div> : <MarkdownContent content={comment.content} />}
       {!comment.deleted && <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground"><button type="button" className={`inline-flex items-center gap-1 hover:text-primary ${voted ? 'text-primary' : ''}`} onClick={() => vote.mutate({ commentId: comment.id }, { onSuccess: (result) => { setScore(result.score); setVoted(result.voted); query.setQueryData(getGetCommentsQueryKey(postId), (old: Comment[] | undefined) => old?.map((item) => item.id === comment.id ? { ...item, score: result.score, userVoted: result.voted } : item)); } })} data-testid={`button-vote-comment-${comment.id}`}><ArrowUp size={13} /> {score}</button><button type="button" onClick={() => onReply(comment)} className="hover:text-foreground" data-testid={`button-reply-comment-${comment.id}`}>reply</button>{canManage && <><button type="button" onClick={() => setEditing(true)} className="hover:text-foreground" data-testid={`button-edit-comment-${comment.id}`}><Edit3 size={12} /></button><button type="button" onClick={() => { if (window.confirm('Remove this comment?')) remove.mutate({ commentId: comment.id }, { onSuccess: () => query.setQueryData(getGetCommentsQueryKey(postId), (old: Comment[] | undefined) => old?.map((item) => item.id === comment.id ? { ...item, deleted: true, content: '' } : item)) }); }} className="hover:text-destructive" data-testid={`button-delete-comment-${comment.id}`}><Trash2 size={12} /></button></>}<button type="button" onClick={() => { report.mutate({ data: { reason: ReportInputReason.other, targetType: ReportInputTargetType.comment, targetId: comment.id } }); setReported(true); }} className="hover:text-foreground" data-testid={`button-report-comment-${comment.id}`}>{reported ? <Check size={12} /> : <Flag size={12} />}</button></div>}
    </div>
  );
}

function PostPage() {
  const { postId = '' } = useParams<{ postId: string }>();
  const [, setLocation] = useLocation();
  const query = useQueryClient();
  const postQuery = useGetPost(postId, { query: { queryKey: getGetPostQueryKey(postId) } });
  const commentsQuery = useGetComments(postId, { query: { queryKey: getGetCommentsQueryKey(postId) } });
  const update = useUpdatePost();
  const remove = useDeletePost();
  const createComment = useCreateComment();
  const vote = useVoteOnPost();
  const report = useCreateReport();
  const { data: current } = useGetCurrentUser();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [reported, setReported] = useState(false);
  const post = postQuery.data as Post | undefined;
  useEffect(() => { if (post) { setTitle(post.title); setContent(post.content); } }, [post?.id]);
  const comments: Comment[] = commentsQuery.data || [];
  const savePost = () => update.mutate({ postId, data: { title: title.trim(), content } }, { onSuccess: () => { setEditing(false); query.setQueryData(getGetPostQueryKey(postId), (old: Post | undefined) => old ? { ...old, title, content } : old); } });
  const submitComment = (event: FormEvent) => {
    event.preventDefault();
    if (!commentText.trim()) return;
    createComment.mutate({ postId, data: { content: commentText.trim(), parentId: replyTo?.id || null } }, { onSuccess: () => { setCommentText(''); setReplyTo(null); query.invalidateQueries({ queryKey: getGetCommentsQueryKey(postId) }); query.invalidateQueries({ queryKey: getGetPostQueryKey(postId) }); } });
  };
  if (postQuery.isLoading) return <div className="mx-auto max-w-[860px]"><LoadingRows count={3} /></div>;
  if (postQuery.isError || !post) return <div className="mx-auto max-w-[860px]"><ErrorState message={humanError(postQuery.error)} retry={() => postQuery.refetch()} /></div>;
  return (
    <div className="fade-in mx-auto max-w-[860px]">
      <div className="mb-5 flex items-center gap-2 text-xs text-muted-foreground"><Link href="/" className="hover:text-primary" data-testid="link-back-feed">top</Link><ChevronRight size={13} /><span>{typeLabel(post.type)}</span></div>
      <article className="border-y border-border py-6 sm:py-8" data-testid={`article-post-${post.id}`}>
        {editing ? <div className="space-y-4"><input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 w-full border border-input bg-card px-3 text-xl font-semibold" data-testid="input-edit-post-title" /><textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-64 w-full border border-input bg-card p-3 text-[15px] leading-7" data-testid="textarea-edit-post-content" /><div className="flex gap-2"><button type="button" onClick={savePost} disabled={update.isPending} className="bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="button-save-post">save changes</button><button type="button" onClick={() => setEditing(false)} className="border border-border px-4 py-2 text-sm" data-testid="button-cancel-post">cancel</button></div></div> : <><div className="mb-3 flex items-center gap-2 text-[10px] font-semibold tracking-[.16em] text-accent"><span>{typeLabel(post.type)}</span><span className="h-px w-5 bg-accent/40" /></div><h1 className="max-w-3xl text-2xl font-semibold leading-tight tracking-tight sm:text-4xl" data-testid="text-post-title">{post.title}</h1><div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Link href={`/u/${post.author.username}`} className="inline-flex items-center gap-2 font-semibold text-foreground hover:text-primary" data-testid="link-post-author"><Avatar username={post.author.username} />{post.author.username}</Link><span>·</span><span>{timeAgo(post.createdAt)}</span><span>·</span><span>{post.score} points</span>{post.url && <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary" data-testid="link-post-url"><ExternalLink size={12} /> source</a>}</div></>}
        {!editing && <div className="mt-7"><MarkdownContent content={post.content} />{post.media && <img src={`/api/storage${post.media.path}`} alt={post.media.altText} className="mt-6 max-h-[560px] w-auto border border-border" data-testid="img-post-media" />}</div>}
        {!editing && <div className="mt-7 flex flex-wrap items-center gap-4 border-t border-border pt-4"><button type="button" onClick={() => vote.mutate({ postId }, { onSuccess: (result) => query.setQueryData(getGetPostQueryKey(postId), (old: Post | undefined) => old ? { ...old, score: result.score, userVoted: result.voted } : old) })} className={`inline-flex items-center gap-1.5 text-xs font-medium ${post.userVoted ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`} data-testid="button-vote-post-detail"><ArrowUp size={15} /> {post.score} upvote</button>{current?.user?.username === post.author.username && <><button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid="button-edit-post"><Edit3 size={13} /> edit</button><button type="button" onClick={() => { if (window.confirm('Delete this thread?')) remove.mutate({ postId }, { onSuccess: () => { query.invalidateQueries({ queryKey: getGetFeedQueryKey() }); setLocation('/'); } }); }} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive" data-testid="button-delete-post"><Trash2 size={13} /> delete</button></>}<button type="button" onClick={() => { report.mutate({ data: { reason: ReportInputReason.other, targetType: ReportInputTargetType.post, targetId: postId } }); setReported(true); }} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid="button-report-post">{reported ? <Check size={13} /> : <Flag size={13} />} {reported ? 'reported' : 'report'}</button></div>}
      </article>
      <section id="discussion" className="mt-10" data-testid="section-discussion"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Discussion <span className="mono text-sm font-normal text-muted-foreground">({comments.length})</span></h2><span className="mono text-[10px] tracking-[.12em] text-muted-foreground">NESTED SIGNAL</span></div>{current?.user ? <form onSubmit={submitComment} className="mb-8 border border-border bg-card p-3" data-testid="form-create-comment">{replyTo && <div className="mb-2 flex items-center justify-between border-l-2 border-primary bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">replying to {replyTo.author.username}<button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" data-testid="button-cancel-reply"><X size={13} /></button></div>}<textarea required maxLength={20000} value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add something useful…" className="min-h-24 w-full resize-y border-0 bg-transparent p-1 text-sm leading-6 outline-none" data-testid="textarea-new-comment" /><div className="flex items-center justify-between border-t border-border pt-2"><span className="text-xs text-muted-foreground">Be specific. Be kind.</span><button type="submit" disabled={createComment.isPending || !commentText.trim()} className="inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-submit-comment">comment <Send size={12} /></button></div></form> : <div className="mb-8 flex items-center justify-between border border-border bg-card px-4 py-3 text-sm"><span className="text-muted-foreground">Have a useful angle?</span><Link href="/login" className="font-semibold text-primary hover:underline" data-testid="link-comment-login">sign in to join</Link></div>}{commentsQuery.isError ? <ErrorState message={humanError(commentsQuery.error)} retry={() => commentsQuery.refetch()} /> : comments.length ? <div>{comments.map((comment) => <CommentRow key={comment.id} comment={comment} postId={postId} onReply={setReplyTo} canManage={current?.user?.username === comment.author.username} />)}</div> : <EmptyState title="Start the discussion." copy="A thoughtful first response changes the shape of a thread." />}</section>
    </div>
  );
}

function ProfilePage() {
  const { username = '' } = useParams<{ username: string }>();
  const profile = useGetProfile(username, { query: { queryKey: getGetProfileQueryKey(username) } });
  if (profile.isLoading) return <div className="mx-auto max-w-[860px]"><LoadingRows count={4} /></div>;
  if (profile.isError || !profile.data) return <div className="mx-auto max-w-[860px]"><ErrorState message={humanError(profile.error)} retry={() => profile.refetch()} /></div>;
  const data = profile.data;
  return <div className="fade-in mx-auto max-w-[860px]"><div className="mb-8 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-center"><Avatar username={data.user.username} size="lg" /><div><p className="mono mb-1 text-[11px] tracking-[.15em] text-accent">MEMBER PROFILE</p><h1 className="text-2xl font-semibold">{data.user.username}</h1><p className="mt-1 text-xs text-muted-foreground">joined {new Date(data.user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p></div><div className="flex gap-5 text-xs sm:ml-auto"><div><p className="mono text-lg font-medium">{data.karma}</p><p className="text-muted-foreground">karma</p></div><div><p className="mono text-lg font-medium">{data.postCount}</p><p className="text-muted-foreground">posts</p></div><div><p className="mono text-lg font-medium">{data.commentCount}</p><p className="text-muted-foreground">comments</p></div></div></div><div className="grid gap-10 lg:grid-cols-[1.35fr_1fr]"><section><h2 className="mb-3 text-sm font-semibold">Posts <span className="mono font-normal text-muted-foreground">/ {data.posts.length}</span></h2>{data.posts.length ? <div className="border-t border-border">{data.posts.map((post) => <PostCard key={post.id} item={post} />)}</div> : <EmptyState title="No posts yet." copy="The room is waiting." />}</section><section><h2 className="mb-3 text-sm font-semibold">Recent comments <span className="mono font-normal text-muted-foreground">/ {data.comments.length}</span></h2>{data.comments.length ? <div className="divide-y divide-border border-y border-border">{data.comments.map((comment) => <div className="py-4" key={comment.id}><p className="line-clamp-3 text-sm leading-6">{comment.content}</p><p className="mt-2 text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</p></div>)}</div> : <EmptyState title="No comments yet." copy="Useful replies will collect here." />}</section></div></div>;
}

function SearchPage() {
  const [location] = useLocation();
  const q = new URLSearchParams(location.split('?')[1] || '').get('q') || '';
  const results = useSearch({ q }, { query: { queryKey: getSearchQueryKey({ q }), enabled: q.length >= 2 } });
  return <div className="fade-in mx-auto max-w-[860px]"><div className="mb-8 border-b border-border pb-6"><p className="mono mb-3 text-[11px] tracking-[.16em] text-accent">SEARCH INDEX</p><h1 className="text-2xl font-semibold">Results for <span className="text-primary">“{q}”</span></h1><p className="mt-2 text-sm text-muted-foreground">{q.length < 2 ? 'Search needs at least two characters.' : 'Titles, threads, and useful rabbit holes.'}</p></div>{q.length < 2 ? <EmptyState title="Try a longer query." copy="Two characters is enough to start the index." /> : results.isLoading ? <LoadingRows /> : results.isError ? <ErrorState message={humanError(results.error)} retry={() => results.refetch()} /> : results.data?.length ? <div className="border-t border-border">{results.data.map((item) => <PostCard key={item.id} item={item} />)}</div> : <EmptyState title="No matches." copy="Try a different phrase, or start the thread you were looking for." action={<Link href="/new" className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="link-search-create"><Plus size={14} /> start a thread</Link>} />}</div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><AppShell><Switch><Route path="/" component={() => <FeedPage section="top" />} /><Route path="/new" component={CreatePage} /><Route path="/ask" component={() => <FeedPage section="ask" />} /><Route path="/show" component={() => <FeedPage section="show" />} /><Route path="/p/:postId" component={PostPage} /><Route path="/u/:username" component={ProfilePage} /><Route path="/search" component={SearchPage} /><Route path="/login" component={() => <AuthPage mode="login" />} /><Route path="/signup" component={() => <AuthPage mode="signup" />} /><Route component={NotFound} /></Switch></AppShell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;