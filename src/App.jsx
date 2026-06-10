import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Filter,
  Gem,
  Hammer,
  Lock,
  PackageSearch,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
} from "lucide-react";

const DATA_URL = `${import.meta.env.BASE_URL}data/market.json`;

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatPct(value) {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

function VerdictBadge({ verdict }) {
  return <span className={classNames("badge", `badge-${verdict?.toLowerCase()}`)}>{verdict}</span>;
}

function TinyButton({ children, icon: Icon, onClick, href, title }) {
  const content = (
    <>
      {Icon ? <Icon size={15} strokeWidth={1.8} /> : null}
      <span>{children}</span>
    </>
  );

  if (href) {
    return (
      <a className="tiny-button" href={href} target="_blank" rel="noreferrer" title={title}>
        {content}
      </a>
    );
  }

  return (
    <button className="tiny-button" type="button" onClick={onClick} title={title}>
      {content}
    </button>
  );
}

function Header({ data, reloadData, loading }) {
  return (
    <header className="topbar">
      <div className="brand">
        <BarChart3 size={25} strokeWidth={1.8} />
        <div>
          <strong>PoE2 Market Research</strong>
          <span>Rare demand scout</span>
        </div>
      </div>

      <div className="topbar-metadata">
        <div className="meta-pill">
          <span>リーグ</span>
          <strong>{data?.league?.displayName ?? "loading"}</strong>
        </div>
        <div className="meta-pill">
          <span>Snapshot</span>
          <strong>{data?.league?.snapshotVersion ?? "-"}</strong>
        </div>
        <div className="meta-pill">
          <span>最終生成</span>
          <strong>{formatDate(data?.generatedAt)}</strong>
        </div>
      </div>

      <div className="topbar-actions">
        <TinyButton icon={RefreshCw} onClick={reloadData} title="静的JSONを再読込">
          {loading ? "更新中" : "再読込"}
        </TinyButton>
        <div className="privacy-pill">
          <Lock size={15} />
          URL share only
        </div>
      </div>
    </header>
  );
}

function Sidebar({ data, filters, setFilters, slots, classes }) {
  return (
    <aside className="sidebar">
      <div className="panel-heading">
        <Filter size={17} />
        <span>フィルター</span>
      </div>

      <label className="field">
        <span>対象スロット</span>
        <select value={filters.slot} onChange={(event) => setFilters({ ...filters, slot: event.target.value })}>
          <option value="recommended">おすすめ枠のみ</option>
          <option value="all">すべて</option>
          {slots.map((slot) => (
            <option key={slot} value={slot}>
              {slot}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>需要元クラス</span>
        <select value={filters.className} onChange={(event) => setFilters({ ...filters, className: event.target.value })}>
          <option value="all">すべて</option>
          {classes.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>予算帯</span>
        <select value={filters.budget} onChange={(event) => setFilters({ ...filters, budget: event.target.value })}>
          <option value="all">すべて</option>
          <option value="1-5 div">1-5 div</option>
          <option value="5-20 div">5-20 div</option>
          <option value="要確認">要確認</option>
        </select>
      </label>

      <label className="field">
        <span>クラフト範囲</span>
        <select value={filters.craftScope} onChange={(event) => setFilters({ ...filters, craftScope: event.target.value })}>
          <option value="all">すべて</option>
          <option value="Essence/Omen">Essence/Omen</option>
          <option value="Omen tier">Omen tier</option>
          <option value="Manual review">Manual review</option>
        </select>
      </label>

      <label className="field">
        <span>検索</span>
        <div className="search-box">
          <Search size={15} />
          <input
            value={filters.query}
            placeholder="slot, base, mod, build..."
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          />
        </div>
      </label>

      <label className="range-field">
        <span>最低スコア</span>
        <strong>{filters.minScore}</strong>
        <input
          min="0"
          max="95"
          type="range"
          value={filters.minScore}
          onChange={(event) => setFilters({ ...filters, minScore: Number(event.target.value) })}
        />
      </label>

      <div className="class-list">
        <div className="section-title">ビルド分布</div>
        {classes.slice(0, 7).map((item) => (
          <button
            className={classNames("class-row", filters.className === item.name && "is-active")}
            key={item.name}
            type="button"
            onClick={() => setFilters({ ...filters, className: filters.className === item.name ? "all" : item.name })}
          >
            <span>{item.name}</span>
            <strong>{formatPct(item.percentage)}</strong>
          </button>
        ))}
      </div>

      <div className="source-note">
        <Database size={15} />
        <span>
          poe.ninja: {formatNumber(data?.league?.totalCharacters)} chars
          <br />
          mod/craft: rule-based
        </span>
      </div>
    </aside>
  );
}

function RareTable({ items, selected, onSelect }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>
              Score <ArrowUpDown size={13} />
            </th>
            <th>Slot</th>
            <th>Base</th>
            <th>Demand Builds</th>
            <th>Mod Signature</th>
            <th>Craft</th>
            <th>Trade</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              className={classNames(selected?.id === item.id && "selected-row")}
              key={item.id}
              onClick={() => onSelect(item)}
            >
              <td className="score-cell">{item.score}</td>
              <td>{item.slot}</td>
              <td>
                <strong>{item.baseLabel}</strong>
                <small>{formatNumber(item.adoptionCount)} uses</small>
              </td>
              <td>
                <div className="build-stack">
                  {item.classFits.slice(0, 2).map((fit) => (
                    <span key={fit.className}>
                      {fit.className} <b>{formatPct(fit.percentage)}</b>
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <div className="mod-list compact">
                  {item.modSignature.slice(0, 3).map((mod) => (
                    <span key={mod}>{mod}</span>
                  ))}
                </div>
              </td>
              <td>
                <span className="craft-scope">{item.craftScope}</span>
                <small>{item.budget}</small>
              </td>
              <td>
                <a className="icon-link" href={item.trade.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                  Search <ExternalLink size={14} />
                </a>
              </td>
              <td>
                <VerdictBadge verdict={item.verdict} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SideDetail({ selected, copyText }) {
  if (!selected) {
    return (
      <aside className="detail-pane">
        <div className="empty-state">候補を選択してください。</div>
      </aside>
    );
  }

  return (
    <aside className="detail-pane">
      <div className="detail-title">
        <div>
          <span>選択中</span>
          <h2>{selected.baseLabel}</h2>
          <p>{selected.slot}</p>
        </div>
        <VerdictBadge verdict={selected.verdict} />
      </div>

      <div className="metric-grid">
        <div>
          <span>需要スコア</span>
          <strong>{selected.score}</strong>
        </div>
        <div>
          <span>全体採用</span>
          <strong>{formatPct(selected.adoptionPct)}</strong>
        </div>
        <div>
          <span>予算</span>
          <strong>{selected.budget}</strong>
        </div>
      </div>

      <section className="detail-section">
        <h3>需要ソース</h3>
        <div className="fit-list">
          {selected.classFits.map((fit) => (
            <div key={fit.className}>
              <span>{fit.className}</span>
              <div className="bar">
                <i style={{ width: `${Math.min(fit.percentage, 100)}%` }} />
              </div>
              <strong>{formatPct(fit.percentage)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>推奨mod</h3>
        <ul className="check-list">
          {selected.modSignature.map((mod) => (
            <li key={mod}>
              <CheckCircle2 size={16} />
              {mod}
            </li>
          ))}
        </ul>
      </section>

      <section className="detail-section">
        <h3>クラフトメモ</h3>
        <ol className="step-list">
          {selected.craftPlan.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="detail-section warning">
        <h3>
          <AlertTriangle size={16} />
          避ける理由
        </h3>
        <ul>
          {selected.riskFlags.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      </section>

      <section className="detail-section">
        <h3>生成された検索</h3>
        <div className="trade-query">{selected.trade.query}</div>
        <div className="button-row">
          <TinyButton href={selected.trade.url} icon={ExternalLink}>
            Trade
          </TinyButton>
          <TinyButton href={selected.poeNinjaUrl} icon={ExternalLink}>
            poe.ninja
          </TinyButton>
          <TinyButton icon={Copy} onClick={() => copyText(selected.trade.query)}>
            Query
          </TinyButton>
        </div>
      </section>
    </aside>
  );
}

function PreviewTable({ title, icon: Icon, rows, kind }) {
  return (
    <section className="preview-panel">
      <div className="content-header">
        <div>
          <span>{kind === "unique" ? "Future tab" : "Future tab"}</span>
          <h1>
            <Icon size={20} />
            {title}
          </h1>
        </div>
      </div>
      <div className="table-wrap simple">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Usage</th>
              <th>Judgment</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 24).map((row) => (
              <tr key={row.name}>
                <td>
                  <strong>{row.name}</strong>
                </td>
                <td>{row.type ?? "Gem"}</td>
                <td>{formatPct(row.adoptionPct)}</td>
                <td>{row.note}</td>
                <td>
                  <a className="icon-link" href={row.poeNinjaUrl} target="_blank" rel="noreferrer">
                    poe.ninja <ExternalLink size={14} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function App() {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState("rare");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({
    slot: "recommended",
    className: "all",
    budget: "all",
    craftScope: "all",
    minScore: 54,
    query: "",
  });

  async function loadData(cacheBust = false) {
    setLoading(true);
    setError("");
    try {
      if (typeof window !== "undefined" && window.__MARKET_DATA__) {
        const payload = window.__MARKET_DATA__;
        setData(payload);
        setSelectedId((current) => current ?? payload.rare?.opportunities?.[0]?.id ?? null);
        return;
      }

      const url = cacheBust ? `${DATA_URL}?t=${Date.now()}` : DATA_URL;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`market.json not found (${response.status})`);
      const payload = await response.json();
      setData(payload);
      setSelectedId((current) => current ?? payload.rare?.opportunities?.[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const slots = useMemo(() => {
    return [...new Set(data?.rare?.opportunities?.map((item) => item.slot) ?? [])].sort();
  }, [data]);

  const filteredRare = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return (data?.rare?.opportunities ?? []).filter((item) => {
      if (filters.slot === "recommended" && !item.targetSlot) return false;
      if (filters.slot !== "all" && filters.slot !== "recommended" && item.slot !== filters.slot) return false;
      if (filters.className !== "all" && !item.classFits.some((fit) => fit.className === filters.className)) return false;
      if (filters.budget !== "all" && item.budget !== filters.budget) return false;
      if (filters.craftScope !== "all" && item.craftScope !== filters.craftScope) return false;
      if (item.score < filters.minScore) return false;
      if (!query) return true;
      return [item.baseLabel, item.slot, item.topClass, item.budget, item.craftScope, ...item.modSignature]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [data, filters]);

  const selected = useMemo(() => {
    return filteredRare.find((item) => item.id === selectedId) ?? filteredRare[0] ?? null;
  }, [filteredRare, selectedId]);

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
    setNotice("検索テキストをコピーしました");
    window.setTimeout(() => setNotice(""), 1800);
  }

  if (error) {
    return (
      <main className="app-shell">
        <div className="fatal">
          <AlertTriangle />
          <h1>データを読めませんでした</h1>
          <p>{error}</p>
          <code>npm run update:data</code>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Header data={data} reloadData={() => loadData(true)} loading={loading} />

      <div className="layout">
        <Sidebar data={data} filters={filters} setFilters={setFilters} slots={slots} classes={data?.classes ?? []} />

        <section className="workspace">
          <div className="tabs">
            <button className={classNames(activeTab === "rare" && "active")} type="button" onClick={() => setActiveTab("rare")}>
              <Hammer size={16} />
              Rare
            </button>
            <button className={classNames(activeTab === "unique" && "active")} type="button" onClick={() => setActiveTab("unique")}>
              <Sparkles size={16} />
              Unique
            </button>
            <button className={classNames(activeTab === "gems" && "active")} type="button" onClick={() => setActiveTab("gems")}>
              <Gem size={16} />
              Gems
            </button>
          </div>

          {activeTab === "rare" ? (
            <>
              <div className="content-header">
                <div>
                  <span>poe.ninja Builds / latest normal league</span>
                  <h1>
                    <Table2 size={21} />
                    Rare Demand
                  </h1>
                </div>
                <div className="toolbar">
                  <span>{filteredRare.length} / {data?.rare?.opportunities?.length ?? 0} candidates</span>
                  <TinyButton icon={SlidersHorizontal} onClick={() => setFilters({ ...filters, slot: filters.slot === "recommended" ? "all" : "recommended" })}>
                    {filters.slot === "recommended" ? "全枠表示" : "おすすめ枠"}
                  </TinyButton>
                </div>
              </div>
              <RareTable items={filteredRare} selected={selected} onSelect={(item) => setSelectedId(item.id)} />
            </>
          ) : null}

          {activeTab === "unique" ? <PreviewTable title="Unique Watch" icon={PackageSearch} rows={data?.unique ?? []} kind="unique" /> : null}
          {activeTab === "gems" ? <PreviewTable title="Gem 21/20 Watch" icon={Gem} rows={data?.gems ?? []} kind="gems" /> : null}
        </section>

        {activeTab === "rare" ? <SideDetail selected={selected} copyText={copyText} /> : <aside className="detail-pane muted-pane">
          <ShieldCheck size={20} />
          <h2>MVP focus: Rare first</h2>
          <p>Unique/Gemは採用率プレビューのみ。価格・出品数・corrupt/21品質の自動判定は次の段階で追加します。</p>
        </aside>}
      </div>

      {notice ? <div className="toast">{notice}</div> : null}
    </main>
  );
}
