import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ConnectionForm from '../components/ConnectionForm';
import ChartCard from '../components/ChartCard';
import Loader from '../components/Loader';

const API = 'http://localhost:5000/api';

const KPI_GRADIENTS = [
  { gradient: ['#667eea','#764ba2'], shadow: 'rgba(102,126,234,0.4)' },
  { gradient: ['#11998e','#38ef7d'], shadow: 'rgba(17,153,142,0.4)'  },
  { gradient: ['#f7971e','#ffd200'], shadow: 'rgba(247,151,30,0.4)'  },
  { gradient: ['#eb3349','#f45c43'], shadow: 'rgba(235,51,73,0.4)'   },
];

function formatKpiValue(kpi) {
  const { value, prefix = '', suffix = '' } = kpi;
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (isNaN(num)) return String(value);
  const formatted = num >= 1000
    ? num.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : num % 1 !== 0 ? num.toFixed(2) : String(num);
  return `${prefix}${formatted}${suffix}`;
}

// ── Storage utilities ──────────────────────────────────────────────────────────

const DB_STORE_KEY = 'ai_dashboard_dbs';

const dbStore = {
  load: ()        => JSON.parse(localStorage.getItem(DB_STORE_KEY) || '[]'),
  save: (dbs)     => localStorage.setItem(DB_STORE_KEY, JSON.stringify(dbs)),
  add(record)     { const dbs = this.load(); dbs.push(record); this.save(dbs); },
  remove(id)      { this.save(this.load().filter(d => d.id !== id)); },
};

// Connection strings are sensitive — keep in sessionStorage only (cleared on tab close)
const getConn  = (id)      => sessionStorage.getItem(`ai_conn_${id}`) || '';
const saveConn = (id, val) => sessionStorage.setItem(`ai_conn_${id}`, val);
const dropConn = (id)      => sessionStorage.removeItem(`ai_conn_${id}`);

function makeDisplayName(connectionString, schema) {
  try {
    const url    = new URL(connectionString);
    const dbName = url.pathname.replace('/', '') || url.hostname;
    return `${dbName} / ${schema}`;
  } catch {
    return `Database / ${schema}`;
  }
}

// Strip live data arrays from an insight so only the SQL + chart structure is stored
function toTemplate(insight) {
  const cfg = JSON.parse(JSON.stringify(insight.echartsConfig));
  if (cfg.xAxis) cfg.xAxis.data = [];
  if (cfg.series) cfg.series.forEach(s => { s.data = []; });
  return {
    title: insight.title,
    description: insight.description,
    sql: insight.sql,
    chartType: insight.chartType,
    echartsConfig: cfg,
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [databases,      setDatabases]      = useState([]);
  const [activeId,       setActiveId]       = useState(null);
  const [liveData,       setLiveData]       = useState({});
  const [showAddForm,    setShowAddForm]    = useState(false);
  const [reconnectId,    setReconnectId]    = useState(null);
  const [reconnectInput, setReconnectInput] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError,   setConnectError]   = useState('');
  const [connectStep,    setConnectStep]    = useState(0);

  // ── on mount: restore from localStorage, auto-refresh if session creds exist ──
  useEffect(() => {
    const stored = dbStore.load();
    if (stored.length === 0) { setShowAddForm(true); return; }
    setDatabases(stored);
    setActiveId(stored[0].id);
    stored.forEach(db => {
      const conn = getConn(db.id);
      if (conn) doRefresh(db, conn);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── refresh: replay stored SQL, skip LLM ──────────────────────────────────
  const doRefresh = async (db, conn) => {
    setLiveData(prev => ({ ...prev, [db.id]: { ...prev[db.id], loading: true, error: null } }));
    try {
      const { data } = await axios.post(`${API}/refresh-insights`, {
        connectionString: conn,
        dbSchema:         db.dbSchema,
        insights:         db.insightTemplates,
        kpiDefs:          db.kpiTemplates,
      });
      setLiveData(prev => ({
        ...prev,
        [db.id]: { insights: data.insights, kpis: data.kpis, loading: false, error: null, lastRefreshed: Date.now() },
      }));
    } catch (err) {
      setLiveData(prev => ({
        ...prev,
        [db.id]: { ...prev[db.id], loading: false, error: err.response?.data?.error || err.message },
      }));
    }
  };

  // ── first-time connect: run full LLM pipeline, then save templates ────────
  const handleConnect = async (connectionString, schema = 'public') => {
    setConnectError(''); setConnectLoading(true); setConnectStep(0);
    try {
      setConnectStep(1);
      const { data: { schema: tableSchema, profile } } = await axios.post(`${API}/connect`, {
        connectionString, dbSchema: schema,
      });
      const uniqueNames = [...new Set(tableSchema.map(r => r.table_name))];
      const tableCount  = [...new Set(tableSchema.filter(r => r.object_type === 'BASE TABLE').map(r => r.table_name))].length;
      const viewCount   = uniqueNames.length - tableCount;

      setConnectStep(2);
      const { data: { insights: generated, kpis: generatedKpis } } = await axios.post(`${API}/insights`, {
        connectionString, schema: tableSchema, profile, dbSchema: schema,
      });
      setConnectStep(4);

      const id = crypto.randomUUID();
      const record = {
        id,
        displayName:       makeDisplayName(connectionString, schema),
        dbSchema:          schema,
        dbInfo:            { tableCount, viewCount, columnCount: tableSchema.length },
        insightTemplates:  generated.filter(i => i.sql).map(toTemplate),
        kpiTemplates:      (generatedKpis || []).map(k => ({
          label: k.label, icon: k.icon, sql: k.sql, prefix: k.prefix, suffix: k.suffix,
        })),
        savedAt: Date.now(),
      };
      dbStore.add(record);
      saveConn(id, connectionString);

      const newDbs = dbStore.load();
      setDatabases(newDbs);
      setActiveId(id);
      setLiveData(prev => ({
        ...prev,
        [id]: { insights: generated, kpis: generatedKpis || [], loading: false, error: null, lastRefreshed: Date.now() },
      }));
      setShowAddForm(false);
    } catch (err) {
      setConnectError(err.response?.data?.error || err.message || 'Something went wrong.');
    } finally {
      setConnectLoading(false); setConnectStep(0);
    }
  };

  // ── reconnect: restore session creds, re-run SQL ─────────────────────────
  const handleReconnect = async (db) => {
    if (!reconnectInput.trim()) return;
    const conn = reconnectInput.trim();
    saveConn(db.id, conn);
    setReconnectId(null);
    setReconnectInput('');
    await doRefresh(db, conn);
  };

  // ── remove a DB from sidebar + storage ────────────────────────────────────
  const handleRemoveDb = (id) => {
    dbStore.remove(id);
    dropConn(id);
    const remaining = dbStore.load();
    setDatabases(remaining);
    setLiveData(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (activeId === id) {
      const next = remaining[0];
      setActiveId(next?.id || null);
      if (!next) setShowAddForm(true);
    }
  };

  // ── regenerate: drop stored templates, re-run full LLM pipeline ──────────
  const handleRegenerate = (db) => {
    const conn = getConn(db.id);
    if (!conn) { setReconnectId(db.id); return; }
    dbStore.remove(db.id);
    dropConn(db.id);
    setDatabases(dbStore.load());
    setLiveData(prev => { const n = { ...prev }; delete n[db.id]; return n; });
    setActiveId(null);
    handleConnect(conn, db.dbSchema);
  };

  // ── full-page loader during initial LLM pipeline ─────────────────────────
  if (connectLoading) return <Loader currentStep={connectStep} />;

  const activeDb   = databases.find(d => d.id === activeId);
  const activeLive = liveData[activeId] || {};

  // ── dashboard content for the active DB ──────────────────────────────────
  const renderDashboard = () => {
    if (!activeDb) return null;
    const { insights = [], kpis = [], loading: dbLoading, error: dbError, lastRefreshed } = activeLive;
    const conn = getConn(activeDb.id);
    const successInsights = insights.filter(i => !i.queryError && !i.noData);
    const failedInsights  = insights.filter(i =>  i.queryError ||  i.noData);

    return (
      <div style={s.page}>
        <style>{`
          @keyframes spin  { to { transform: rotate(360deg); } }
          @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        `}</style>

        {/* TOPBAR */}
        <header style={s.topbar}>
          <div style={s.brand}>
            <div style={s.brandIcon}>⚡</div>
            <div>
              <div style={s.brandName}>{activeDb.displayName}</div>
              <div style={s.brandSub}>
                {activeDb.dbInfo?.tableCount} tables
                {activeDb.dbInfo?.viewCount > 0 && ` · ${activeDb.dbInfo.viewCount} views`}
                {` · ${activeDb.dbInfo?.columnCount} columns`}
                {lastRefreshed && ` · refreshed ${Math.round((Date.now() - lastRefreshed) / 60000)}m ago`}
              </div>
            </div>
          </div>
          <div style={s.topbarRight}>
            {dbLoading
              ? <span style={s.liveText}>⟳ Refreshing…</span>
              : <><div style={s.liveDot} /><span style={s.liveText}>Live</span></>
            }
            <button
              onClick={() => conn && doRefresh(activeDb, conn)}
              style={{ ...s.btnSecondary, opacity: dbLoading || !conn ? 0.4 : 1 }}
              disabled={dbLoading || !conn}
            >
              ↻ Refresh Data
            </button>
            <button
              onClick={() => handleRegenerate(activeDb)}
              style={{ ...s.btnPrimary, opacity: dbLoading ? 0.4 : 1 }}
              disabled={dbLoading}
            >
              ✦ Regenerate
            </button>
          </div>
        </header>

        <div style={s.body}>
          {!conn && (
            <div style={s.warnBanner}>
              Session expired — click this database in the sidebar and enter your connection string to refresh data.
            </div>
          )}
          {dbError && <div style={s.errorBanner}>⚠️ {dbError}</div>}

          {dbLoading && insights.length === 0 ? (
            <div style={s.spinnerWrap}>
              <div style={s.spinner} />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px' }}>Loading fresh data…</span>
            </div>
          ) : (
            <>
              {/* KPI CARDS */}
              <div style={s.kpiRow}>
                {(kpis.length > 0 ? kpis : Array(4).fill(null)).map((kpi, i) => {
                  const meta = KPI_GRADIENTS[i % KPI_GRADIENTS.length];
                  return (
                    <div key={i} style={{ ...s.kpiCard, boxShadow: `0 8px 32px ${meta.shadow}` }}>
                      <div style={{ ...s.kpiGradient, background: `linear-gradient(135deg,${meta.gradient[0]},${meta.gradient[1]})` }} />
                      <div style={s.kpiInner}>
                        <div style={s.kpiTop}>
                          <span style={s.kpiLabel}>{kpi?.label ?? 'Loading…'}</span>
                          <div style={{ ...s.kpiIconBox, background: `linear-gradient(135deg,${meta.gradient[0]},${meta.gradient[1]})` }}>
                            {kpi?.icon ?? '◈'}
                          </div>
                        </div>
                        <div style={s.kpiValue}>{kpi ? formatKpiValue(kpi) : '…'}</div>
                        <div style={s.kpiBar}>
                          <div style={{
                            ...s.kpiBarFill,
                            width: kpi?.value ? '70%' : '0%',
                            background: `linear-gradient(90deg,${meta.gradient[0]},${meta.gradient[1]})`,
                          }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* CHARTS */}
              <div style={s.sectionHead}>
                <span style={s.sectionTitle}>📊 Insights Overview</span>
                <span style={s.sectionCount}>{successInsights.length} charts rendered</span>
              </div>
              {successInsights[0] && (
                <div style={s.wideCard}>
                  <ChartCard index={0} insight={successInsights[0]} wide />
                </div>
              )}
              {successInsights.length > 1 && (
                <div style={s.grid}>
                  {successInsights.slice(1).map((insight, i) => (
                    <ChartCard key={i + 1} index={i + 1} insight={insight} />
                  ))}
                </div>
              )}

              {failedInsights.length > 0 && (
                <>
                  <div style={{ ...s.sectionHead, marginTop: '32px' }}>
                    <span style={{ ...s.sectionTitle, color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
                      ⚠ {failedInsights.length} insight{failedInsights.length > 1 ? 's' : ''} could not be rendered
                    </span>
                  </div>
                  <div style={s.failedGrid}>
                    {failedInsights.map((insight, i) => (
                      <ChartCard key={`f${i}`} index={insights.indexOf(insight)} insight={insight} compact />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <footer style={s.footer}>
          <span style={s.footerDot} />
          Powered by LangChain · Groq LLaMA 3 70B · Apache ECharts
          <span style={s.footerDot} />
        </footer>
      </div>
    );
  };

  // ── root layout ───────────────────────────────────────────────────────────
  return (
    <div style={s.appShell}>

      {/* SIDEBAR */}
      <aside style={s.sidebar}>
        <div style={s.sidebarTop}>
          <div style={s.sidebarIcon}>⚡</div>
          <span style={s.sidebarTitle}>AI Dashboard</span>
        </div>

        <div style={s.sidebarLabel}>Databases</div>

        <div style={s.dbList}>
          {databases.map(db => {
            const live       = liveData[db.id] || {};
            const hasConn    = !!getConn(db.id);
            const isActive   = db.id === activeId;
            const needsRecon = !hasConn && !live.loading;
            const dotColor   = live.loading ? '#ffd200' : hasConn ? '#38ef7d' : '#eb3349';

            return (
              <div key={db.id}>
                <div
                  style={{ ...s.dbItem, ...(isActive ? s.dbItemActive : {}) }}
                  onClick={() => {
                    setActiveId(db.id);
                    setShowAddForm(false);
                    if (needsRecon) setReconnectId(prev => prev === db.id ? null : db.id);
                    else setReconnectId(null);
                  }}
                >
                  <div style={s.dbItemRow}>
                    <span style={{ ...s.dbDot, background: dotColor, boxShadow: `0 0 5px ${dotColor}` }} />
                    <span style={s.dbItemName} title={db.displayName}>{db.displayName}</span>
                    <button
                      style={s.removeBtn}
                      onClick={e => { e.stopPropagation(); handleRemoveDb(db.id); }}
                      title="Remove"
                    >×</button>
                  </div>
                  <div style={s.dbItemMeta}>
                    <span style={s.schemaBadge}>{db.dbSchema}</span>
                    {live.loading  && <span style={s.tagSyncing}>syncing</span>}
                    {needsRecon    && <span style={s.tagReconn}>reconnect</span>}
                    {live.lastRefreshed && !live.loading && (
                      <span style={s.tagTime}>
                        {Math.round((Date.now() - live.lastRefreshed) / 60000)}m ago
                      </span>
                    )}
                  </div>
                </div>

                {/* Inline reconnect form */}
                {reconnectId === db.id && (
                  <div style={s.reconnForm}>
                    <input
                      style={s.reconnInput}
                      type="password"
                      placeholder="Paste connection string…"
                      value={reconnectInput}
                      onChange={e => setReconnectInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleReconnect(db)}
                      autoFocus
                    />
                    <div style={s.reconnActions}>
                      <button style={s.reconnBtn} onClick={() => handleReconnect(db)}>Connect</button>
                      <button style={s.reconnCancel} onClick={() => { setReconnectId(null); setReconnectInput(''); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          style={s.addDbBtn}
          onClick={() => { setShowAddForm(true); setActiveId(null); setReconnectId(null); }}
        >
          ＋ Add Database
        </button>
      </aside>

      {/* MAIN CONTENT */}
      <div style={s.mainArea}>
        {showAddForm
          ? <ConnectionForm onSubmit={handleConnect} loading={connectLoading} error={connectError} />
          : renderDashboard()
        }
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  /* root shell */
  appShell: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    background: 'linear-gradient(160deg, #080818 0%, #0d0d26 60%, #080818 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  /* sidebar */
  sidebar: {
    width: '220px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255,255,255,0.02)',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    overflowY: 'auto',
    paddingBottom: '16px',
  },
  sidebarTop: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '18px 16px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  sidebarIcon: {
    width: '32px', height: '32px', flexShrink: 0,
    background: 'linear-gradient(135deg,#667eea,#764ba2)',
    borderRadius: '8px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '16px',
    boxShadow: '0 4px 12px rgba(102,126,234,0.4)',
  },
  sidebarTitle: {
    color: '#fff', fontSize: '14px', fontWeight: '700', letterSpacing: '-0.2px',
  },
  sidebarLabel: {
    color: 'rgba(255,255,255,0.2)', fontSize: '10px', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: '1px',
    padding: '14px 16px 6px',
  },
  dbList: { flex: 1 },
  dbItem: {
    padding: '10px 14px',
    cursor: 'pointer',
    borderLeft: '2px solid transparent',
    transition: 'background 0.15s',
  },
  dbItemActive: {
    background: 'rgba(102,126,234,0.1)',
    borderLeftColor: '#667eea',
  },
  dbItemRow: {
    display: 'flex', alignItems: 'center', gap: '8px',
  },
  dbDot: {
    width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
  },
  dbItemName: {
    flex: 1,
    color: 'rgba(255,255,255,0.75)', fontSize: '12px', fontWeight: '500',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  removeBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)',
    cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px',
    flexShrink: 0,
    ':hover': { color: '#eb3349' },
  },
  dbItemMeta: {
    display: 'flex', alignItems: 'center', gap: '6px',
    marginTop: '5px', paddingLeft: '15px',
  },
  schemaBadge: {
    background: 'rgba(102,126,234,0.15)', color: '#667eea',
    fontSize: '10px', fontWeight: '600', padding: '1px 6px',
    borderRadius: '4px', letterSpacing: '0.3px',
  },
  tagSyncing: {
    background: 'rgba(255,210,0,0.1)', color: '#ffd200',
    fontSize: '10px', fontWeight: '600', padding: '1px 6px', borderRadius: '4px',
  },
  tagReconn: {
    background: 'rgba(235,51,73,0.1)', color: '#eb3349',
    fontSize: '10px', fontWeight: '600', padding: '1px 6px', borderRadius: '4px',
  },
  tagTime: {
    color: 'rgba(255,255,255,0.2)', fontSize: '10px',
  },

  /* inline reconnect form */
  reconnForm: {
    margin: '4px 14px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    padding: '10px',
  },
  reconnInput: {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: '#fff',
    fontSize: '11px', padding: '7px 10px',
    outline: 'none',
  },
  reconnActions: {
    display: 'flex', gap: '6px', marginTop: '8px',
  },
  reconnBtn: {
    flex: 1, padding: '6px', border: 'none', borderRadius: '6px',
    background: 'linear-gradient(135deg,#667eea,#764ba2)',
    color: '#fff', fontSize: '11px', fontWeight: '600', cursor: 'pointer',
  },
  reconnCancel: {
    flex: 1, padding: '6px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px', color: 'rgba(255,255,255,0.4)',
    fontSize: '11px', cursor: 'pointer',
  },

  /* add database button */
  addDbBtn: {
    margin: '12px 14px 0',
    padding: '9px 0',
    background: 'rgba(102,126,234,0.1)',
    border: '1px dashed rgba(102,126,234,0.35)',
    borderRadius: '8px',
    color: '#667eea', fontSize: '12px', fontWeight: '600',
    cursor: 'pointer', letterSpacing: '0.2px',
    transition: 'background 0.15s',
  },

  /* main content area */
  mainArea: {
    flex: 1, overflowY: 'auto', height: '100vh',
  },

  /* page (dashboard content) */
  page: {
    minHeight: '100%',
    paddingBottom: '60px',
  },

  /* topbar */
  topbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 36px',
    background: 'rgba(255,255,255,0.02)',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    backdropFilter: 'blur(16px)',
    position: 'sticky', top: 0, zIndex: 100,
    flexWrap: 'wrap', gap: '12px',
  },
  brand: { display: 'flex', alignItems: 'center', gap: '12px' },
  brandIcon: {
    width: '38px', height: '38px',
    background: 'linear-gradient(135deg,#667eea,#764ba2)',
    borderRadius: '10px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '18px',
    boxShadow: '0 4px 16px rgba(102,126,234,0.4)',
  },
  brandName: { color: '#fff', fontSize: '16px', fontWeight: '700', letterSpacing: '-0.3px' },
  brandSub:  { color: 'rgba(255,255,255,0.25)', fontSize: '11px', marginTop: '2px' },
  topbarRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  liveDot: {
    width: '8px', height: '8px', borderRadius: '50%',
    background: '#38ef7d',
    boxShadow: '0 0 8px #38ef7d',
    animation: 'pulse 2s ease-in-out infinite',
  },
  liveText: { color: 'rgba(56,239,125,0.8)', fontSize: '12px', fontWeight: '600', marginRight: '4px' },
  btnPrimary: {
    padding: '8px 18px',
    background: 'linear-gradient(135deg,#667eea,#764ba2)',
    border: 'none', color: '#fff',
    borderRadius: '8px', cursor: 'pointer',
    fontSize: '13px', fontWeight: '600',
    boxShadow: '0 4px 12px rgba(102,126,234,0.35)',
  },
  btnSecondary: {
    padding: '8px 18px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.6)',
    borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500',
  },

  /* body */
  body: { padding: '28px 36px 0' },

  warnBanner: {
    marginBottom: '20px', padding: '14px 20px',
    background: 'rgba(255,210,0,0.06)', border: '1px solid rgba(255,210,0,0.2)',
    borderRadius: '12px', color: '#ffd200', fontSize: '13px',
  },
  errorBanner: {
    marginBottom: '20px', padding: '14px 20px',
    background: 'rgba(238,102,102,0.08)', border: '1px solid rgba(238,102,102,0.2)',
    borderRadius: '12px', color: '#EE6666', fontSize: '14px',
  },

  /* spinner for per-DB loading */
  spinnerWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: '16px', paddingTop: '120px',
  },
  spinner: {
    width: '36px', height: '36px', borderRadius: '50%',
    border: '3px solid rgba(255,255,255,0.08)',
    borderTopColor: '#667eea',
    animation: 'spin 0.8s linear infinite',
  },

  /* KPI */
  kpiRow: { display: 'flex', gap: '18px', marginBottom: '32px', flexWrap: 'wrap' },
  kpiCard: {
    flex: '1 1 180px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '18px', overflow: 'hidden', position: 'relative', minHeight: '130px',
  },
  kpiGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: '3px' },
  kpiInner: { padding: '20px 22px' },
  kpiTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  kpiLabel: { color: 'rgba(255,255,255,0.45)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.8px' },
  kpiIconBox: {
    width: '34px', height: '34px', borderRadius: '10px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '16px', color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  kpiValue: { color: '#fff', fontSize: '36px', fontWeight: '800', letterSpacing: '-2px', lineHeight: 1, marginBottom: '14px' },
  kpiBar: { height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' },
  kpiBarFill: { height: '100%', borderRadius: '2px', transition: 'width 1s ease' },

  /* section */
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' },
  sectionTitle: { color: '#fff', fontSize: '16px', fontWeight: '700', letterSpacing: '-0.2px' },
  sectionCount: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.35)', fontSize: '12px',
    padding: '4px 14px', borderRadius: '20px', fontWeight: '600',
  },

  wideCard: { marginBottom: '20px' },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
    gap: '18px', marginBottom: '20px',
  },
  failedGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '14px',
  },

  footer: {
    textAlign: 'center', color: 'rgba(255,255,255,0.15)',
    fontSize: '12px', paddingTop: '48px', letterSpacing: '0.5px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
  },
  footerDot: {
    display: 'inline-block', width: '4px', height: '4px',
    borderRadius: '50%', background: 'rgba(255,255,255,0.15)',
  },
};
