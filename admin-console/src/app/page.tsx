"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

type Row = Record<string, unknown>;
type View = "overview" | "users" | "projects" | "jobs" | "audit" | "system";
type AdminUser = { id: string; name: string; email: string; emailVerified: boolean; disabledAt: string | null; createdAt: string };
type SessionUser = { id: string; name: string; email: string };
type Column = [string, (row: Row) => unknown];

const API = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
const statusNames: Record<string, string> = { pending: "排队中", running: "运行中", done: "已完成", failed: "失败", canceled: "已取消" };
const menu: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "运营概览", icon: "grid" }, { id: "users", label: "用户账号", icon: "users" },
  { id: "projects", label: "项目元数据", icon: "folder" }, { id: "jobs", label: "模型任务", icon: "activity" },
  { id: "audit", label: "操作审计", icon: "shield" }, { id: "system", label: "系统状态", icon: "server" },
];
const titles: Record<View, string> = { overview: "运营概览", users: "用户账号", projects: "项目元数据", jobs: "模型任务", audit: "操作审计", system: "系统状态" };
const descriptions: Record<View, string> = {
  overview: "查看平台规模与近期任务，快速了解服务运行情况。", users: "管理账号状态与访问权限，不展示用户创作内容。",
  projects: "查看项目归属和存储元数据，不展示正文内容。", jobs: "追踪模型任务状态，不展示提示词或模型响应。",
  audit: "按时间查看管理员操作记录。", system: "检查核心服务依赖与文件存储状态。",
};
const asObject = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};
const asRows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
const show = (value: unknown) => value == null || value === "" ? "—" : String(value);
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
const date = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "—";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "—" : dateFormatter.format(timestamp);
};
const initials = (value: string) => value.trim().slice(0, 1).toUpperCase() || "管";

async function api(path: string, init?: RequestInit) {
  if (!API) throw new Error("尚未设置 NEXT_PUBLIC_API_BASE_URL。");
  const response = await fetch(`${API}${path}`, { ...init, credentials: "include", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? body.message ?? "请求失败，请稍后重试。");
  return body;
}

export default function AdminHome() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [role, setRole] = useState("");
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<Row>({});
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [searchInput, setSearchInput] = useState(""); const [search, setSearch] = useState(""); const [status, setStatus] = useState("");
  const [page, setPage] = useState(1); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null); const [reason, setReason] = useState("");

  useEffect(() => {
    api("/api/v1/auth/get-session").then(result => setUser(result?.user ?? null))
      .catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setError(""); setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("q", search);
      if (status) params.set("status", status);
      const endpoint = view === "overview" ? "overview" : view;
      const result = await api(`/api/admin/${endpoint}?${params}`);
      if (view === "overview") setRole(result.role ?? "");
      setData(result);
    } catch (e) { setError(e instanceof Error ? e.message : "读取数据失败。"); }
    finally { setLoading(false); }
  }, [user, view, page, search, status]);

  useEffect(() => {
    if (!user) return;
    let current = true;
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("q", search);
    if (status) params.set("status", status);
    const endpoint = view === "overview" ? "overview" : view;
    api(`/api/admin/${endpoint}?${params}`).then(result => {
      if (!current) return;
      if (view === "overview") setRole(result.role ?? "");
      setData(result);
    }).catch((e: Error) => { if (current) setError(e.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [user, view, page, search, status]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await api("/api/v1/auth/sign-in/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password, rememberMe: true }) });
      const result = await api("/api/v1/auth/get-session");
      if (!result?.user) throw new Error("登录成功但未取得会话，请重试。");
      setUser(result.user); setPassword(""); setView("overview"); setPage(1);
    } catch (e) { setError(e instanceof Error ? e.message : "登录失败，请检查账号和密码。"); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await api("/api/v1/auth/sign-out", { method: "POST" }); setUser(null); setData({}); setRole(""); }
    catch (e) { setError(e instanceof Error ? e.message : "退出失败。"); }
    finally { setBusy(false); }
  }

  async function toggleUser(target: AdminUser) {
    const disabled = !target.disabledAt;
    if (disabled && reason.trim().length < 3) { setError("请填写至少 3 个字符的停用原因。"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target.id, disabled, reason }) });
      setSelected(null); setReason(""); setNotice(disabled ? `已停用 ${target.email}，现有会话已撤销。` : `已恢复 ${target.email}。`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  if (loading && !user) return <LoginFrame><div className="login-loading"><span className="spinner" />正在确认管理会话…</div></LoginFrame>;
  if (!user) return <LoginFrame><form className="login-form" onSubmit={signIn}>
    <div className="login-kicker"><Icon name="shield" /> 管理员专用入口</div><h2>欢迎回来</h2><p className="login-description">使用已获授权的长忆账号继续。</p>
    {error && <div role="alert" className="alert"><Icon name="alert" />{error}</div>}
    <label className="field">邮箱地址<input className="input" autoComplete="username" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
    <label className="field">密码<input className="input" autoComplete="current-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="输入账号密码" /></label>
    <button className="button primary login-submit" disabled={busy}>{busy ? <><span className="spinner light" />正在登录…</> : <>安全登录 <Icon name="arrow" /></>}</button>
    <div className="login-security"><Icon name="lock" /><span>管理操作会由服务端校验权限并记录审计。</span></div>
  </form></LoginFrame>;

  const activeMenu = menu.find(item => item.id === view)!;
  const visibleMenu = menu.filter(item => item.id !== "audit" || role === "super_admin");
  const list = asRows(data.users ?? data.projects ?? data.jobs ?? data.logs);
  const total = Number(data.total ?? list.length);
  const totalPages = Math.max(1, Math.ceil(total / 25));
  const columns: Record<Exclude<View, "overview" | "system">, Column[]> = {
    users: [["账号", r => `${show(r.name)} · ${show(r.email)}`], ["项目", r => r.projectCount], ["邮箱验证", r => r.emailVerified ? "已验证" : "未验证"], ["角色", r => r.role ?? "用户"], ["注册时间", r => date(r.createdAt)], ["状态", r => r.disabledAt ? "已停用" : "正常"]],
    projects: [["项目", r => r.name], ["账号", r => asObject(r.owner).email], ["语言 / 题材", r => `${r.language ?? ""}${r.genre ? ` · ${r.genre}` : ""}`], ["章节", r => r.chapterCount], ["文档", r => r.documentCount], ["源文件体积", r => `${(Number(r.storageBytes ?? 0) / 1048576).toFixed(1)} MB`], ["更新", r => date(r.updatedAt)]],
    jobs: [["任务", r => r.taskType], ["状态", r => statusNames[String(r.status)] ?? r.status], ["项目", r => asObject(r.project).name], ["账号", r => asObject(asObject(r.project).owner).email], ["创建时间", r => date(r.createdAt)], ["开始时间", r => date(r.startedAt)], ["结束时间", r => date(r.finishedAt)]],
    audit: [["操作", r => r.action], ["操作者", r => asObject(r.actor).email], ["对象", r => `${r.targetType}${r.targetId ? ` · ${r.targetId}` : ""}`], ["详情", r => { try { return Object.entries(JSON.parse(String(r.detailJson ?? "{}")) as Row).map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || "—"; } catch { return "—"; } }], ["时间", r => date(r.createdAt)]],
  };

  return <div className="admin-frame">
    <aside className="sidebar"><Brand /><div className="nav-section-label">工作空间</div><nav className="nav-list" aria-label="管理端导航">{visibleMenu.map(item => <button key={item.id} aria-current={view === item.id ? "page" : undefined} onClick={() => { setView(item.id); setPage(1); setSearch(""); setSearchInput(""); setStatus(""); setError(""); }} className={`nav-item ${view === item.id ? "active" : ""}`}><Icon name={item.icon} />{item.label}{view === item.id && <span className="nav-current" />}</button>)}</nav>
      <div className="sidebar-spacer" /><div className="privacy-card"><span className="privacy-icon"><Icon name="lock" /></span><div><strong>隐私保护</strong><p>管理端仅访问业务元数据，不开放用户创作内容。</p></div></div>
      <div className="sidebar-footer"><span className="status-dot" /> 私有管理环境</div>
    </aside>
    <main className="main"><header className="topbar"><div className="breadcrumb"><span>长忆平台</span><Icon name="chevron" /><strong>{activeMenu.label}</strong></div><div className="identity"><span className="identity-role"><Icon name="shield" />{roleName(role)}</span><span className="identity-divider" /><span className="avatar">{initials(user.name)}</span><span className="identity-email">{user.email}</span><button className="icon-button signout" disabled={busy} onClick={signOut} aria-label="退出登录" title="退出登录"><Icon name="logout" /></button></div></header>
      <div className="content"><div className="page-heading"><div><div className="eyebrow">PLATFORM / {activeMenu.id.toUpperCase()}</div><h1>{titles[view]}</h1><p className="subtitle">{descriptions[view]}</p></div>{view === "system" && <button className="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" />{loading ? "正在刷新" : "刷新状态"}</button>}</div>
        {error && <div role="alert" className="alert"><Icon name="alert" />{error}</div>}{notice && <div role="status" className="notice"><Icon name="check" />{notice}</div>}
        {view === "overview" && <Overview data={data} role={role} onNavigate={setView} />}
        {view === "system" && <System data={data} />}
        {view !== "overview" && view !== "system" && <section className="panel table-panel"><div className="panel-head"><div><h2 className="panel-title">{titles[view]}</h2><p className="panel-caption">{view === "users" ? "账号状态与项目数量，不包含用户内容。" : view === "projects" ? "只显示项目元数据和原文件体积，不包含正文。" : view === "jobs" ? "不返回提示词、输入内容、错误正文或模型响应。" : "仅限超级管理员查看的追加式操作记录。"}</p></div><div className="toolbar">{(view === "users" || view === "projects") && <form className="toolbar search-form" role="search" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); }}><label className="search-box"><Icon name="search" /><input className="search-input" aria-label={view === "users" ? "搜索账号" : "搜索项目"} value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder={view === "users" ? "搜索邮箱或昵称" : "搜索项目或账号"} /></label><button className="button primary">搜索</button></form>}{view === "jobs" && <label className="select-wrap"><span className="sr-only">按任务状态筛选</span><select className="select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">全部状态</option>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><Icon name="chevron" /></label>}</div></div>
          <div className="table-wrap"><table><thead><tr>{columns[view as Exclude<View, "overview" | "system">].map(([label]) => <th key={label}>{label}</th>)}{view === "users" && <th>操作</th>}</tr></thead><tbody>{list.map((row, index) => <tr key={String(row.id ?? index)}>{columns[view as Exclude<View, "overview" | "system">].map(([label, pick]) => <td key={label}>{label === "状态" ? <StatusPill tone={row.disabledAt ? "danger" : "success"}>{row.disabledAt ? "已停用" : "正常"}</StatusPill> : label === "邮箱验证" ? <StatusPill tone={row.emailVerified ? "success" : "neutral"}>{row.emailVerified ? "已验证" : "未验证"}</StatusPill> : label === "角色" ? <span className={`role-text ${row.role ? "admin-role" : ""}`}>{row.role ? roleName(String(row.role)) : "普通用户"}</span> : <span className={label === "账号" || label === "项目" ? "table-primary" : ""}>{show(pick(row))}</span>}</td>)}{view === "users" && <td>{row.role ? <span className="protected-label"><Icon name="lock" />管理员</span> : <button className={`button button-small ${row.disabledAt ? "" : "danger"}`} onClick={() => { setSelected(row as AdminUser); setReason(""); setError(""); }}>{row.disabledAt ? "恢复账号" : "停用账号"}</button>}</td>}</tr>)}</tbody></table>{loading && <div className="table-state"><span className="spinner" />正在加载数据…</div>}{!loading && !list.length && <div className="empty"><span className="empty-icon"><Icon name="search" /></span><strong>没有找到记录</strong><span>尝试调整搜索条件后重试。</span></div>}</div>
          <div className="pagination"><span>显示 <strong>{list.length ? (page - 1) * 25 + 1 : 0}–{Math.min(page * 25, total)}</strong> 条，共 <strong>{total}</strong> 条</span><div className="pagination-controls"><span>第 {page} / {totalPages} 页</span><button className="icon-button" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}><Icon name="chevron-left" /></button><button className="icon-button" aria-label="下一页" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}><Icon name="chevron-right" /></button></div></div>
        </section>}
      </div>
    </main>
    {selected && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="disable-title"><div className={`modal-icon ${selected.disabledAt ? "restore" : "suspend"}`}><Icon name={selected.disabledAt ? "check" : "alert"} /></div><h2 id="disable-title">{selected.disabledAt ? "恢复此账号？" : "停用此账号？"}</h2><p className="modal-account">{selected.name}<br /><span>{selected.email}</span></p>{!selected.disabledAt && <label className="field">停用原因<span className="field-hint">该说明将记录在管理员审计日志中</span><textarea className="textarea" maxLength={240} value={reason} onChange={e => setReason(e.target.value)} placeholder="请说明停用原因（至少 3 个字符）" /></label>}<div className="modal-actions"><button className="button" onClick={() => setSelected(null)}>取消</button><button className={`button ${selected.disabledAt ? "primary" : "danger solid-danger"}`} disabled={busy} onClick={() => void toggleUser(selected)}>{busy ? <><span className="spinner light" />处理中…</> : selected.disabledAt ? "确认恢复" : "停用并撤销会话"}</button></div></section></div>}
  </div>;
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    users: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" /><circle cx="9.5" cy="7" r="4" /><path d="M20.5 20v-1.5a4 4 0 0 0-3-3.87M16.5 3.2a4 4 0 0 1 0 7.6" /></>,
    folder: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><path d="M3 10h18" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    server: <><rect x="3" y="3" width="18" height="8" rx="2" /><rect x="3" y="13" width="18" height="8" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /><path d="M12 14v3" /></>,
    alert: <><path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 4h.01" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    "chevron-left": <path d="m15 18-6-6 6-6" />,
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.6-2.6L20 12M4 12l2.8 5.6A7 7 0 0 0 18.4 15" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.grid}</svg>;
}

function Brand() { return <div className="brand"><span className="brand-mark"><span>长</span></span><div><div className="brand-title">长忆平台</div><div className="brand-caption">管理控制台</div></div></div>; }
function roleName(role: string) { return ({ super_admin: "超级管理员", operator: "运营管理员", observer: "只读管理员" } as Record<string, string>)[role] ?? "管理员"; }
function StatusPill({ children, tone }: { children: React.ReactNode; tone: string }) { return <span className={`status-pill ${tone}`}><span className="pill-dot" />{children}</span>; }

function LoginFrame({ children }: { children: React.ReactNode }) {
  return <div className="login-screen"><div className="login-art"><Brand /><div className="login-story"><div className="login-kicker"><span className="story-dot" /> 长忆平台 · 管理控制台</div><h1>把复杂运营，<br /><em>变得一目了然。</em></h1><p>在一个清晰、可靠的空间里掌握平台状态与用户服务。</p><div className="login-feature"><span><Icon name="shield" /></span><div><strong>权限清晰，操作可追溯</strong><small>每次管理操作都会经过服务端校验并留存记录</small></div></div></div><div className="login-copy">© 2026 长忆平台 <span>·</span> 私有管理环境</div></div><div className="login-side"><div className="login-side-top"><span className="secure-mark"><Icon name="lock" /></span><span>安全管理员登录</span></div>{children}<div className="login-side-footer">仅限获授权的管理员访问</div></div></div>;
}

function Overview({ data, role, onNavigate }: { data: Row; role: string; onNavigate: (view: View) => void }) {
  const counts = asObject(data.counts);
  const cards: [string, number | string, string, string, string][] = [
    ["注册用户", Number(counts.users ?? 0), "所有账号", "users", "blue"], ["小说项目", Number(counts.projects ?? 0), "用户创建的项目", "folder", "violet"],
    ["模型任务", Number(counts.runs ?? 0), "累计任务记录", "activity", "teal"], ["待处理 / 异常", `${counts.activeRuns ?? 0} / ${counts.failedRuns ?? 0}`, "运行中与失败任务", "alert", "amber"],
  ];
  const runs = asRows(data.recentRuns);
  return <><section className="metrics">{cards.map(([label, value, caption, icon, tone]) => <article className="metric" key={label}><div className="metric-top"><span className="metric-label">{label}</span><span className={`metric-icon ${tone}`}><Icon name={icon} /></span></div><div className="metric-value">{typeof value === "number" ? new Intl.NumberFormat("zh-CN").format(value) : value}</div><div className="metric-foot">{caption}</div></article>)}</section>
    <div className="overview-grid"><section className="panel"><div className="panel-head"><div><h2 className="panel-title">近期模型任务</h2><p className="panel-caption">最近创建的任务及其当前进度</p></div><button className="text-button" onClick={() => onNavigate("jobs")}>查看全部 <Icon name="arrow" /></button></div><div className="table-wrap"><table><thead><tr><th>任务 / 项目</th><th>账号</th><th>状态</th><th>创建时间</th></tr></thead><tbody>{runs.map(row => <tr key={String(row.id)}><td><span className="table-primary">{show(row.taskType)}</span><span className="table-secondary">{show(asObject(row.project).name)}</span></td><td>{show(asObject(asObject(row.project).owner).email)}</td><td><StatusPill tone={row.status === "failed" ? "danger" : ["pending", "running"].includes(String(row.status)) ? "warning" : "success"}>{statusNames[String(row.status)] ?? show(row.status)}</StatusPill></td><td>{date(row.createdAt)}</td></tr>)}</tbody></table>{!runs.length && <div className="empty"><span className="empty-icon"><Icon name="activity" /></span><strong>暂时没有任务</strong><span>新的模型任务会显示在这里。</span></div>}</div></section>
      <section className="panel platform-panel"><div className="panel-head"><div><h2 className="panel-title">平台概况</h2><p className="panel-caption">当前管理环境与权限信息</p></div></div><div className="platform-role"><span className="role-emblem"><Icon name="shield" /></span><div><span>当前登录身份</span><strong>{roleName(role)}</strong></div><StatusPill tone="success">有效</StatusPill></div><div className="platform-list"><div className="platform-row"><span>账号安全</span><span><i className="mini-dot green" />停用时撤销会话</span></div><div className="platform-row"><span>用户内容</span><span><i className="mini-dot gray" />管理端不可访问</span></div><div className="platform-row"><span>操作记录</span><button className="inline-link" onClick={() => onNavigate(role === "super_admin" ? "audit" : "system")}>{role === "super_admin" ? "打开审计记录" : "查看系统状态"}<Icon name="arrow" /></button></div></div><div className="privacy-note"><Icon name="lock" /><span>平台隐私策略持续生效，管理端不提供正文、记忆或草稿访问。</span></div></section></div>
  </>;
}

function System({ data }: { data: Row }) {
  const rows: [string, unknown, string][] = [["应用数据库", data.database, "平台账号与项目元数据"], ["Redis / 会话与验证码", data.redis, "登录会话与验证码缓存"], ["文件存储目录", data.fileStorage, "应用文件读写能力"], ["应用版本", data.appVersion, "当前服务版本"]];
  return <section className="panel system-panel"><div className="panel-head"><div><h2 className="panel-title">服务依赖</h2><p className="panel-caption">检查连接状态和目录可写性，不显示任何连接凭据。</p></div><div className="check-time"><span>最近检查</span><strong>{date(data.checkedAt)}</strong></div></div><div className="health-list">{rows.map(([label, value, hint]) => { const healthy = label === "应用版本" || value === "available"; return <div className="health-row" key={label}><span className="health-icon"><Icon name={label.includes("Redis") ? "activity" : label === "应用版本" ? "grid" : label === "文件存储目录" ? "folder" : "server"} /></span><div className="health-name"><strong>{label}</strong><span>{hint}</span></div><StatusPill tone={healthy ? "success" : value ? "danger" : "neutral"}>{label === "应用版本" ? show(value) : healthy ? "运行正常" : value ? "不可用" : "检查中"}</StatusPill></div>; })}</div></section>;
}
