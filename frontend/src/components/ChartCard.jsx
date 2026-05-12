import React, { useState, useRef } from 'react';
import ReactECharts from 'echarts-for-react';

const CHART_ICON = { bar: '▊', line: '↗', pie: '◉' };
const CHART_COLOR = { bar: '#667eea', line: '#91CC75', pie: '#FAC858' };

export default function ChartCard({ insight, index, wide = false, compact = false }) {
  const { title, description, echartsConfig, queryError, noData, sql } = insight;
  const [sqlOpen, setSqlOpen] = useState(false);
  const chartRef = useRef(null);

  function downloadPNG() {
    const url = chartRef.current?.getEchartsInstance()?.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#0f0f23',
    });
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}.png`;
    a.click();
  }

  function downloadCSV() {
    const series = echartsConfig?.series?.[0];
    if (!series) return;
    let csv;
    if (isPie) {
      csv = 'label,value\n' +
        series.data.map(d => `"${d.name}",${d.value}`).join('\n');
    } else {
      const labels = echartsConfig?.xAxis?.data || [];
      const values = series.data || [];
      csv = 'label,value\n' +
        labels.map((l, i) => `"${l}",${values[i] ?? ''}`).join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const chartType = echartsConfig?.series?.[0]?.type || 'bar';
  const isPie = chartType === 'pie';
  const accentColor = CHART_COLOR[chartType] || '#667eea';

  const finalConfig = {
    backgroundColor: 'transparent',
    title: {
      ...echartsConfig?.title,
      textStyle: { color: '#fff', fontSize: 13, fontWeight: '600' },
    },
    tooltip: isPie
      ? { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)', backgroundColor: 'rgba(15,15,35,0.97)', borderColor: 'rgba(255,255,255,0.08)', textStyle: { color: '#fff', fontSize: 13 } }
      : { trigger: 'axis', backgroundColor: 'rgba(15,15,35,0.97)', borderColor: 'rgba(255,255,255,0.08)', textStyle: { color: '#fff', fontSize: 13 } },
    ...(echartsConfig?.legend && {
      legend: { ...echartsConfig.legend, textStyle: { color: 'rgba(255,255,255,0.55)', fontSize: 12 }, itemGap: 16 },
    }),
    ...(!isPie && {
      grid: { left: '4%', right: '3%', bottom: '18%', top: '12%', containLabel: true },
      xAxis: {
        type: 'category',
        ...echartsConfig?.xAxis,
        axisLabel: { rotate: 30, color: 'rgba(255,255,255,0.45)', fontSize: 11, ...echartsConfig?.xAxis?.axisLabel },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        axisTick: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        ...echartsConfig?.yAxis,
        axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)', type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
    }),
    series: echartsConfig?.series?.map((s) => ({
      ...s,
      ...(s.type === 'bar' && {
        itemStyle: {
          borderRadius: [5, 5, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: accentColor },
              { offset: 1, color: accentColor + '55' },
            ],
          },
        },
        emphasis: { itemStyle: { opacity: 0.85 } },
        barMaxWidth: 48,
      }),
      ...(s.type === 'line' && {
        lineStyle: { width: 2.5, color: accentColor },
        itemStyle: { color: accentColor, borderWidth: 2, borderColor: '#fff' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: accentColor + '33' }, { offset: 1, color: accentColor + '00' }] } },
        symbol: 'circle',
        symbolSize: 6,
        smooth: true,
      }),
      ...(s.type === 'pie' && {
        radius: ['38%', '68%'],
        center: ['50%', '52%'],
        itemStyle: { borderRadius: 6, borderWidth: 2, borderColor: 'rgba(15,15,35,1)' },
        label: { color: 'rgba(255,255,255,0.7)', fontSize: 12, formatter: '{b}\n{d}%' },
        labelLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        emphasis: { itemStyle: { shadowBlur: 16, shadowColor: 'rgba(0,0,0,0.4)' }, scaleSize: 6 },
      }),
    })),
  };

  return (
    <div style={styles.card}>
      {/* Top accent line */}
      <div style={{ ...styles.accentBar, background: accentColor }} />

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <span style={{ ...styles.chartBadge, color: accentColor, borderColor: accentColor + '44', background: accentColor + '12' }}>
            {CHART_ICON[chartType]} {chartType.toUpperCase()}
          </span>
          <span style={styles.indexBadge}>#{(index + 1).toString().padStart(2, '0')}</span>
        </div>
        <h3 style={styles.title}>{title}</h3>
        <p style={styles.description}>{description}</p>
      </div>

      {/* Chart area */}
      <div style={styles.chartWrap}>
        {queryError ? (
          <div style={styles.errorBox}>
            <div style={styles.errorIconWrap}>
              <span style={styles.errorIconLarge}>⚠</span>
            </div>
            <p style={styles.errorTitle}>Query could not be executed</p>
            <p style={styles.errorDetail}>{queryError}</p>
            <div style={styles.errorSqlWrap}>
              <span style={styles.errorSqlLabel}>Failed SQL</span>
              <code style={styles.errorSql}>{sql}</code>
            </div>
          </div>
        ) : noData ? (
          <div style={styles.emptyBox}>
            <div style={styles.emptyIcon}>◎</div>
            <p style={styles.emptyTitle}>No data available</p>
            <p style={styles.emptySubtitle}>The query returned 0 rows for this insight.</p>
          </div>
        ) : (
          <ReactECharts
            ref={chartRef}
            option={finalConfig}
            notMerge={true}
            style={{ height: wide ? '380px' : compact ? '200px' : '300px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        )}
      </div>

      {/* SQL toggle */}
      <div style={styles.footer}>
        <button style={styles.sqlToggle} onClick={() => setSqlOpen((o) => !o)}>
          <span style={styles.sqlToggleIcon}>{sqlOpen ? '▲' : '▼'}</span>
          {sqlOpen ? 'Hide' : 'View'} SQL Query
        </button>
        {!queryError && !noData && (
          <div style={styles.exportRow}>
            <button style={styles.exportBtn} onClick={downloadPNG} title="Download chart as PNG">PNG</button>
            <button style={styles.exportBtn} onClick={downloadCSV} title="Download data as CSV">CSV</button>
            <span style={styles.rowsBadge}>{insight.rowCount ?? '—'} rows</span>
          </div>
        )}
      </div>

      {sqlOpen && (
        <div style={styles.sqlBlock}>
          <pre style={styles.sqlCode}>{sql}</pre>
        </div>
      )}
    </div>
  );
}

const styles = {
  card: {
    background: 'linear-gradient(160deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '18px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    position: 'relative',
  },
  accentBar: {
    height: '3px',
    width: '100%',
    opacity: 0.8,
  },
  header: {
    padding: '20px 22px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartBadge: {
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '1px',
    padding: '3px 10px',
    borderRadius: '20px',
    border: '1px solid',
    fontFamily: 'monospace',
  },
  indexBadge: {
    color: 'rgba(255,255,255,0.15)',
    fontSize: '12px',
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: '1px',
  },
  title: {
    color: '#fff',
    fontSize: '15px',
    fontWeight: '700',
    margin: 0,
    letterSpacing: '-0.2px',
    lineHeight: '1.3',
  },
  description: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: '12.5px',
    lineHeight: '1.65',
    margin: '0 0 4px',
  },
  chartWrap: {
    minHeight: '200px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 8px',
  },
  errorBox: {
    width: '100%',
    margin: '0 14px',
    padding: '24px 20px',
    background: 'rgba(238,102,102,0.06)',
    border: '1px solid rgba(238,102,102,0.15)',
    borderRadius: '12px',
    textAlign: 'center',
  },
  errorIconWrap: {
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    background: 'rgba(238,102,102,0.12)',
    border: '1px solid rgba(238,102,102,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 14px',
  },
  errorIconLarge: { color: '#EE6666', fontSize: '20px' },
  errorTitle: { color: 'rgba(255,255,255,0.75)', fontSize: '13px', fontWeight: '600', margin: '0 0 6px' },
  errorDetail: { color: 'rgba(238,102,102,0.8)', fontSize: '12px', margin: '0 0 14px', lineHeight: '1.5' },
  errorSqlWrap: {
    background: 'rgba(0,0,0,0.2)',
    borderRadius: '8px',
    padding: '10px 12px',
    textAlign: 'left',
  },
  errorSqlLabel: {
    display: 'block',
    color: 'rgba(255,255,255,0.2)',
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    marginBottom: '6px',
  },
  errorSql: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '11px',
    fontFamily: 'monospace',
    wordBreak: 'break-all',
    whiteSpace: 'pre-wrap',
    margin: 0,
  },
  emptyBox: {
    textAlign: 'center',
    padding: '32px 20px',
  },
  emptyIcon: {
    fontSize: '36px',
    color: 'rgba(255,255,255,0.1)',
    marginBottom: '12px',
  },
  emptyTitle: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
    fontWeight: '600',
    margin: '0 0 4px',
  },
  emptySubtitle: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: '12px',
    margin: 0,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 22px 14px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    marginTop: 'auto',
  },
  sqlToggle: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.25)',
    fontSize: '11px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: 0,
    fontFamily: 'inherit',
    letterSpacing: '0.3px',
    transition: 'color 0.2s',
  },
  sqlToggleIcon: { fontSize: '8px' },
  rowsBadge: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.25)',
    fontSize: '10px',
    padding: '3px 10px',
    borderRadius: '20px',
    fontFamily: 'monospace',
    letterSpacing: '0.5px',
  },
  exportRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  exportBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '10px',
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: '0.5px',
    padding: '3px 10px',
    borderRadius: '20px',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
  sqlBlock: {
    margin: '0 22px 16px',
    borderRadius: '10px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  sqlCode: {
    margin: 0,
    padding: '14px 16px',
    background: 'rgba(0,0,0,0.35)',
    color: 'rgba(255,255,255,0.45)',
    fontSize: '11.5px',
    fontFamily: '"Fira Code", "Cascadia Code", monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    lineHeight: '1.7',
  },
};
