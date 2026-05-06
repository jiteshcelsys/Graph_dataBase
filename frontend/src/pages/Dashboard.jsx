import React, { useState } from 'react';
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
  // Format large numbers with commas
  const formatted = num >= 1000
    ? num.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : num % 1 !== 0 ? num.toFixed(2) : String(num);
  return `${prefix}${formatted}${suffix}`;
}

export default function Dashboard() {
  const [insights, setInsights]   = useState([]);
  const [kpis, setKpis]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [step, setStep]           = useState(0);
  const [dbInfo, setDbInfo]       = useState(null);
  const [connStr, setConnStr]     = useState('');
  const [dbSchema, setDbSchema]   = useState('public');

  const handleConnect = async (connectionString, schema = 'public') => {
    setError(''); setInsights([]); setLoading(true); setStep(0);
    setConnStr(connectionString); setDbSchema(schema);
    try {
      setStep(1);
      const { data: { schema: tableSchema, profile } } = await axios.post(`${API}/connect`, {
        connectionString, dbSchema: schema,
      });
      const tableCount = [...new Set(tableSchema.map((r) => r.table_name))].length;
      setDbInfo({ tableCount, columnCount: tableSchema.length });

      setStep(2);
      const { data: { insights: generated, kpis: generatedKpis } } = await axios.post(`${API}/insights`, {
        connectionString, schema: tableSchema, profile, dbSchema: schema,
      });
      setStep(4);
      setInsights(generated);
      setKpis(generatedKpis || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Something went wrong.');
    } finally {
      setLoading(false); setStep(0);
    }
  };

  const handleReset = () => { setInsights([]); setKpis([]); setDbInfo(null); setError(''); setConnStr(''); };

  if (loading) return <Loader currentStep={step} />;
  if (insights.length === 0) return <ConnectionForm onSubmit={handleConnect} loading={loading} error={error} />;


  const successInsights = insights.filter((i) => !i.queryError && !i.noData);
  const failedInsights  = insights.filter((i) =>  i.queryError ||  i.noData);

  return (
    <div style={s.page}>

      {/* ── TOPBAR ── */}
      <header style={s.topbar}>
        <div style={s.brand}>
          <div style={s.brandIcon}>⚡</div>
          <div>
            <div style={s.brandName}>AI Dashboard</div>
            <div style={s.brandSub}>schema: <b>{dbSchema}</b></div>
          </div>
        </div>
        <div style={s.topbarRight}>
          <div style={s.liveDot} /><span style={s.liveText}>Live</span>
          <button onClick={() => handleConnect(connStr, dbSchema)} style={s.btnPrimary}>↻ Regenerate</button>
          <button onClick={handleReset} style={s.btnGhost}>← Disconnect</button>
        </div>
      </header>

      <div style={s.body}>

        {error && <div style={s.errorBanner}>⚠️ {error}</div>}

        {/* ── KPI CARDS ── */}
        <div style={s.kpiRow}>
          {(kpis.length > 0 ? kpis : Array(4).fill(null)).map((kpi, i) => {
            const meta = KPI_GRADIENTS[i % KPI_GRADIENTS.length];
            const displayValue = kpi ? formatKpiValue(kpi) : '…';
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
                  <div style={s.kpiValue}>{displayValue}</div>
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

        {/* ── SECTION: CHARTS ── */}
        <div style={s.sectionHead}>
          <span style={s.sectionTitle}>📊 Insights Overview</span>
          <span style={s.sectionCount}>{successInsights.length} charts rendered</span>
        </div>

        {/* First wide chart (full width) */}
        {successInsights[0] && (
          <div style={s.wideCard}>
            <ChartCard index={0} insight={successInsights[0]} wide />
          </div>
        )}

        {/* 3-column grid for the rest */}
        {successInsights.length > 1 && (
          <div style={s.grid}>
            {successInsights.slice(1).map((insight, i) => (
              <ChartCard key={i + 1} index={i + 1} insight={insight} />
            ))}
          </div>
        )}

        {/* ── FAILED QUERIES (collapsed, not prominent) ── */}
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

      </div>

      {/* ── FOOTER ── */}
      <footer style={s.footer}>
        <span style={s.footerDot} />
        Powered by LangChain · Groq LLaMA 3 70B · Apache ECharts
        <span style={s.footerDot} />
      </footer>
    </div>
  );
}

const s = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #080818 0%, #0d0d26 60%, #080818 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
  btnGhost: {
    padding: '8px 18px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.5)',
    borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
  },

  body: { padding: '28px 36px 0' },

  errorBanner: {
    marginBottom: '20px', padding: '14px 20px',
    background: 'rgba(238,102,102,0.08)', border: '1px solid rgba(238,102,102,0.2)',
    borderRadius: '12px', color: '#EE6666', fontSize: '14px',
  },

  /* KPI */
  kpiRow: { display: 'flex', gap: '18px', marginBottom: '32px', flexWrap: 'wrap' },
  kpiCard: {
    flex: '1 1 180px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '18px',
    overflow: 'hidden',
    position: 'relative',
    minHeight: '130px',
  },
  kpiGradient: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
  },
  kpiInner: { padding: '20px 22px' },
  kpiTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  kpiLabel: { color: 'rgba(255,255,255,0.45)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.8px' },
  kpiIconBox: {
    width: '34px', height: '34px', borderRadius: '10px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '16px', color: '#fff',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  kpiValue: { color: '#fff', fontSize: '36px', fontWeight: '800', letterSpacing: '-2px', lineHeight: 1, marginBottom: '14px' },
  kpiBar: { height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' },
  kpiBarFill: { height: '100%', borderRadius: '2px', transition: 'width 1s ease' },

  /* section */
  sectionHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: '16px',
  },
  sectionTitle: { color: '#fff', fontSize: '16px', fontWeight: '700', letterSpacing: '-0.2px' },
  sectionCount: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.35)', fontSize: '12px',
    padding: '4px 14px', borderRadius: '20px', fontWeight: '600',
  },

  /* wide first chart */
  wideCard: { marginBottom: '20px' },

  /* grid */
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '18px',
    marginBottom: '20px',
  },

  /* failed */
  failedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: '14px',
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
