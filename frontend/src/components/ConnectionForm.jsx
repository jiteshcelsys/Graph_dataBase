import React, { useState } from 'react';
import axios from 'axios';

const API = 'http://localhost:5000/api';

export default function ConnectionForm({ onSubmit, loading }) {
  const [fields, setFields] = useState({
    host: 'localhost',
    port: '5432',
    database: '',
    username: 'postgres',
    password: '',
  });
  const [dbSchema, setDbSchema] = useState('public');
  const [schemas, setSchemas] = useState([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState('');

  const handleChange = (e) => {
    setFields((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    // Reset schemas when connection fields change
    setSchemas([]);
    setDbSchema('public');
    setSchemaError('');
  };

  // URL-encode credentials so special chars (@ # ! etc.) don't break the connection URL
  const buildConnectionString = () => {
    const { host, port, database, username, password } = fields;
    const user = encodeURIComponent(username);
    const pass = encodeURIComponent(password);
    return `postgresql://${user}:${pass}@${host}:${port}/${database}`;
  };

  const handleLoadSchemas = async () => {
    if (!fields.host || !fields.database) return;
    setSchemaLoading(true);
    setSchemaError('');
    try {
      const { data } = await axios.post(`${API}/schemas`, {
        connectionString: buildConnectionString(),
      });
      setSchemas(data.schemas);
      if (data.schemas.length > 0 && !data.schemas.includes(dbSchema)) {
        setDbSchema(data.schemas[0]);
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Could not connect to database.';
      setSchemaError(msg);
    } finally {
      setSchemaLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(buildConnectionString(), dbSchema);
  };

  const canSubmit = fields.host.trim() && fields.database.trim() && !loading;

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <span style={styles.icon}>⚡</span>
        </div>
        <h1 style={styles.heading}>AI Dashboard Generator</h1>
        <p style={styles.sub}>
          Enter your PostgreSQL connection details and let AI generate business insights with interactive charts.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Row 1: Host + Port */}
          <div style={styles.row}>
            <div style={{ flex: 3 }}>
              <label style={styles.label}>Host</label>
              <input
                name="host"
                value={fields.host}
                onChange={handleChange}
                placeholder="localhost"
                style={styles.input}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Port</label>
              <input
                name="port"
                value={fields.port}
                onChange={handleChange}
                placeholder="5432"
                type="number"
                min={1}
                max={65535}
                style={styles.input}
                disabled={loading}
              />
            </div>
          </div>

          {/* Row 2: Database */}
          <div>
            <label style={styles.label}>Database Name</label>
            <input
              name="database"
              value={fields.database}
              onChange={handleChange}
              placeholder="mydb"
              style={styles.input}
              disabled={loading}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {/* Row 3: Username + Password */}
          <div style={styles.row}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Username</label>
              <input
                name="username"
                value={fields.username}
                onChange={handleChange}
                placeholder="postgres"
                style={styles.input}
                disabled={loading}
                autoComplete="off"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Password</label>
              <input
                name="password"
                value={fields.password}
                onChange={handleChange}
                placeholder="••••••••"
                type="password"
                style={styles.input}
                disabled={loading}
                autoComplete="current-password"
              />
            </div>
          </div>

          {/* Row 4: Schema selector */}
          <div>
            <label style={styles.label}>Database Schema</label>
            <div style={styles.schemaRow}>
              {schemas.length > 0 ? (
                <select
                  value={dbSchema}
                  onChange={(e) => setDbSchema(e.target.value)}
                  style={{ ...styles.input, ...styles.select }}
                  disabled={loading}
                >
                  {schemas.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={dbSchema}
                  onChange={(e) => setDbSchema(e.target.value)}
                  placeholder="public"
                  style={styles.input}
                  disabled={loading}
                  spellCheck={false}
                />
              )}
              <button
                type="button"
                onClick={handleLoadSchemas}
                disabled={schemaLoading || !fields.host || !fields.database || loading}
                style={styles.loadSchemaBtn}
                title="Connect and fetch available schemas"
              >
                {schemaLoading ? '...' : '⟳ Load'}
              </button>
            </div>
            {schemaError && <p style={styles.schemaError}>{schemaError}</p>}
            {schemas.length > 0 && (
              <p style={styles.schemaHint}>
                {schemas.length} schema{schemas.length > 1 ? 's' : ''} found — select the one containing your tables.
              </p>
            )}
          </div>

          {/* Preview */}
          {fields.host && fields.database && (
            <div style={styles.preview}>
              <span style={styles.previewLabel}>Connection preview</span>
              <code style={styles.previewCode}>
                postgresql://{encodeURIComponent(fields.username)}:{'•'.repeat(fields.password.length || 3)}@{fields.host}:{fields.port}/{fields.database}
              </code>
              <code style={{ ...styles.previewCode, marginTop: '6px', color: 'rgba(145,204,117,0.85)' }}>
                schema: <strong>{dbSchema}</strong>
              </code>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{ ...styles.button, ...(!canSubmit ? styles.buttonDisabled : {}) }}
          >
            {loading ? (
              <span style={styles.btnContent}>
                <span style={styles.spinner} /> Analyzing Database...
              </span>
            ) : (
              '🚀 Generate Dashboard'
            )}
          </button>
        </form>

        <div style={styles.features}>
          {['Schema extraction', 'AI-powered insights', 'Live SQL execution', 'ECharts visualization'].map((f) => (
            <span key={f} style={styles.badge}>{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  card: {
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '20px',
    padding: '48px',
    maxWidth: '580px',
    width: '100%',
    boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
    textAlign: 'center',
  },
  iconWrap: { marginBottom: '16px' },
  icon: { fontSize: '48px' },
  heading: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#fff',
    margin: '0 0 12px',
    letterSpacing: '-0.5px',
  },
  sub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: '15px',
    lineHeight: '1.6',
    margin: '0 0 32px',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' },
  row: { display: 'flex', gap: '12px' },
  label: {
    display: 'block',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '11px',
    fontWeight: '600',
    marginBottom: '6px',
    letterSpacing: '0.7px',
    textTransform: 'uppercase',
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    fontFamily: 'monospace',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  },
  preview: {
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    padding: '12px 14px',
  },
  previewLabel: {
    display: 'block',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '11px',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    marginBottom: '6px',
  },
  previewCode: {
    color: 'rgba(102,126,234,0.9)',
    fontSize: '12px',
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  button: {
    width: '100%',
    padding: '15px',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '4px',
    letterSpacing: '0.3px',
  },
  buttonDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  schemaRow: { display: 'flex', gap: '8px', alignItems: 'center' },
  select: { cursor: 'pointer', appearance: 'none', backgroundImage: 'none' },
  loadSchemaBtn: {
    padding: '12px 14px',
    background: 'rgba(102,126,234,0.15)',
    border: '1px solid rgba(102,126,234,0.35)',
    borderRadius: '10px',
    color: '#667eea',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  schemaError: { color: '#EE6666', fontSize: '12px', margin: '6px 0 0' },
  schemaHint: { color: 'rgba(145,204,117,0.7)', fontSize: '12px', margin: '6px 0 0' },
  btnContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
  },
  spinner: {
    display: 'inline-block',
    width: '16px',
    height: '16px',
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  features: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    justifyContent: 'center',
    marginTop: '28px',
  },
  badge: {
    background: 'rgba(102,126,234,0.2)',
    border: '1px solid rgba(102,126,234,0.4)',
    color: 'rgba(255,255,255,0.7)',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
  },
};
