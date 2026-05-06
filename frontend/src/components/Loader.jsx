import React from 'react';

const steps = [
  { icon: '🔌', label: 'Connecting to database' },
  { icon: '📊', label: 'Extracting schema & statistics' },
  { icon: '🤖', label: 'AI generating insights (Groq / LLaMA 3)' },
  { icon: '⚡', label: 'Executing SQL queries' },
  { icon: '🎨', label: 'Building chart configurations' },
];

export default function Loader({ currentStep = 0 }) {
  return (
    <div style={styles.overlay}>
      <div style={styles.box}>
        <div style={styles.spinnerWrap}>
          <div style={styles.ring} />
          <span style={styles.pulse}>⚡</span>
        </div>
        <h2 style={styles.heading}>Generating Dashboard</h2>
        <p style={styles.sub}>This takes 15–30 seconds</p>

        <div style={styles.steps}>
          {steps.map((step, i) => (
            <div
              key={i}
              style={{
                ...styles.step,
                ...(i < currentStep ? styles.stepDone : {}),
                ...(i === currentStep ? styles.stepActive : {}),
                ...(i > currentStep ? styles.stepPending : {}),
              }}
            >
              <span style={styles.stepIcon}>{step.icon}</span>
              <span style={styles.stepLabel}>{step.label}</span>
              {i < currentStep && <span style={styles.check}>✓</span>}
              {i === currentStep && <span style={styles.activeDot} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10,10,30,0.92)',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  box: {
    textAlign: 'center',
    padding: '48px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '20px',
    maxWidth: '420px',
    width: '90%',
    boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
  },
  spinnerWrap: { position: 'relative', display: 'inline-block', marginBottom: '24px' },
  ring: {
    width: '64px',
    height: '64px',
    border: '3px solid rgba(102,126,234,0.2)',
    borderTopColor: '#667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    display: 'inline-block',
  },
  pulse: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%,-50%)',
    fontSize: '24px',
  },
  heading: { color: '#fff', fontSize: '22px', fontWeight: '700', margin: '0 0 8px' },
  sub: { color: 'rgba(255,255,255,0.4)', fontSize: '14px', margin: '0 0 32px' },
  steps: { display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    borderRadius: '10px',
    fontSize: '14px',
    transition: 'all 0.3s',
  },
  stepDone: { background: 'rgba(145,204,117,0.1)', color: 'rgba(145,204,117,0.9)' },
  stepActive: { background: 'rgba(102,126,234,0.15)', color: '#fff' },
  stepPending: { color: 'rgba(255,255,255,0.25)' },
  stepIcon: { fontSize: '18px', minWidth: '24px' },
  stepLabel: { flex: 1 },
  check: { color: '#91CC75', fontWeight: '700' },
  activeDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#667eea',
    animation: 'pulse 1s ease-in-out infinite',
  },
};
