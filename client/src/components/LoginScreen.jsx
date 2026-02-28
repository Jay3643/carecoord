import React, { useState } from 'react';
import { api } from '../api';
import Icon from './Icons';

export default function LoginScreen({ onLogin }) {
  const [step, setStep] = useState('login'); // login, 2fa, setup_2fa, confirm_2fa, change_password
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [qrCode, setQrCode] = useState(null);
  const [manualKey, setManualKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showManualKey, setShowManualKey] = useState(false);
  const [serverCode, setServerCode] = useState('');
  const [serverTime, setServerTime] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.login(email.trim().toLowerCase(), password);
      if (data.step === '2fa') {
        setStep('2fa');
      } else if (data.step === 'setup_2fa') {
        await startSetup2fa();
      } else if (data.step === 'change_password') {
        setStep('change_password');
      } else if (data.step === 'done') {
        onLogin(data.user);
      }
    } catch (e) {
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async (e) => {
    e.preventDefault();
    if (!code.trim() || code.trim().length < 6) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.verify2fa(code.trim());
      if (data.step === 'done') onLogin(data.user);
    } catch (e) {
      setError(e.message || 'Invalid code');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const startSetup2fa = async () => {
    try {
      const data = await api.setup2fa();
      setQrCode(data.qrCode);
      setManualKey(data.manualKey);
      if (data.currentCode) setServerCode(data.currentCode);
      if (data.serverTime) setServerTime(data.serverTime);
      setStep('setup_2fa');
    } catch (e) {
      setError(e.message || 'Failed to generate 2FA');
    }
  };

  const handleConfirm2fa = async (e) => {
    e.preventDefault();
    if (!code.trim() || code.trim().length < 6) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.confirm2fa(code.trim());
      if (data.step === 'done') onLogin(data.user);
    } catch (e) {
      setError(e.message || 'Invalid code');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await api.changePassword(newPassword);
      if (data.step === 'setup_2fa') {
        await startSetup2fa();
      } else if (data.step === '2fa') {
        setStep('2fa');
      } else if (data.step === 'done') {
        onLogin(data.user);
      }
    } catch (e) {
      setError(e.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '12px 16px', background: '#f0f4f9', border: '1px solid #c0d0e4',
    borderRadius: 8, color: '#1e3a4f', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  const btnStyle = (enabled) => ({
    width: '100%', padding: '12px', background: enabled ? '#1a5e9a' : '#c0d0e4',
    color: enabled ? '#fff' : '#6b8299', border: 'none', borderRadius: 8,
    cursor: enabled ? 'pointer' : 'default', fontSize: 14, fontWeight: 600,
  });

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f2f6fa, #e0ecf6)', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      <div style={{ width: 400, background: '#ffffff', borderRadius: 16, padding: 40, boxShadow: '0 8px 32px rgba(0,0,0,0.08)', border: '1px solid #c0d0e4' }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32, justifyContent: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, #1a5e9a, #2878b8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={18} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 20, color: '#1e3a4f', letterSpacing: -0.5 }}>Seniority</span>
        </div>

        {/* ── LOGIN STEP ── */}
        {step === 'login' && (
          <form onSubmit={handleLogin}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', marginBottom: 4, textAlign: 'center' }}>Sign In</h2>
            <p style={{ fontSize: 13, color: '#6b8299', textAlign: 'center', marginBottom: 24 }}>Enter your credentials to continue</p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@seniorityhealthcare.com" style={inputStyle} autoFocus />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" style={inputStyle} />
            </div>

            {error && <div style={{ color: '#d94040', fontSize: 12, marginBottom: 16, textAlign: 'center', fontWeight: 500 }}>{error}</div>}

            <button type="submit" disabled={loading || !email.trim() || !password.trim()}
              style={btnStyle(!loading && email.trim() && password.trim())}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* ── 2FA VERIFY STEP ── */}
        {step === '2fa' && (
          <form onSubmit={handleVerify2fa}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: '#e8f0f8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Icon name="shield" size={24} />
              </div>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', marginBottom: 4 }}>Two-Factor Authentication</h2>
              <p style={{ fontSize: 13, color: '#6b8299' }}>Enter the 6-digit code from your authenticator app</p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <input type="text" value={code} onChange={e => setCode(e.target.value.replace(/D/g, '').slice(0, 6))}
                placeholder="000000" maxLength={6}
                style={{ ...inputStyle, textAlign: 'center', fontSize: 28, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 8, fontWeight: 700 }}
                autoFocus />
            </div>

            {error && <div style={{ color: '#d94040', fontSize: 12, marginBottom: 16, textAlign: 'center', fontWeight: 500 }}>{error}</div>}

            <button type="submit" disabled={loading || code.length < 6}
              style={btnStyle(!loading && code.length >= 6)}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>

            <button type="button" onClick={() => { setStep('login'); setCode(''); setError(''); }}
              style={{ width: '100%', padding: '10px', background: 'none', border: 'none', color: '#6b8299', cursor: 'pointer', fontSize: 12, marginTop: 12 }}>
              ← Back to sign in
            </button>
          </form>
        )}

        {/* ── SETUP 2FA STEP ── */}
        {step === 'setup_2fa' && (
          <form onSubmit={handleConfirm2fa}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', marginBottom: 4 }}>Set Up Two-Factor Authentication</h2>
              <p style={{ fontSize: 13, color: '#6b8299' }}>Scan this QR code with your authenticator app</p>
            </div>

            {qrCode && (
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <img src={qrCode} alt="2FA QR Code" style={{ width: 200, height: 200, borderRadius: 8, border: '1px solid #c0d0e4' }} />
              </div>
            )}

            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <button type="button" onClick={() => setShowManualKey(!showManualKey)}
                style={{ background: 'none', border: 'none', color: '#1a5e9a', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                {showManualKey ? 'Hide manual key' : "Can't scan? Enter key manually"}
              </button>
              {showManualKey && (
                <div style={{ marginTop: 8, padding: '10px 16px', background: '#f0f4f9', borderRadius: 8, fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, wordBreak: 'break-all', color: '#1e3a4f', userSelect: 'all' }}>
                  {manualKey}
                </div>
              )}
            </div>

            

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Verify — Enter 6-digit code from app</label>
              <input type="text" value={code} onChange={e => setCode(e.target.value.replace(/D/g, '').slice(0, 6))}
                placeholder="000000" maxLength={6}
                style={{ ...inputStyle, textAlign: 'center', fontSize: 22, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 6, fontWeight: 700 }}
                autoFocus />
            </div>

            {error && <div style={{ color: '#d94040', fontSize: 12, marginBottom: 16, textAlign: 'center', fontWeight: 500 }}>{error}</div>}

            <button type="submit" disabled={loading || code.length < 6}
              style={btnStyle(!loading && code.length >= 6)}>
              {loading ? 'Verifying...' : 'Verify & Enable 2FA'}
            </button>
          </form>
        )}

        {/* ── CHANGE PASSWORD STEP ── */}
        {step === 'change_password' && (
          <form onSubmit={handleChangePassword}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', marginBottom: 4 }}>Set Your Password</h2>
              <p style={{ fontSize: 13, color: '#6b8299' }}>You're using a temporary password. Please create a new one.</p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>New Password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 characters" style={inputStyle} autoFocus />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password" style={inputStyle} />
            </div>

            {error && <div style={{ color: '#d94040', fontSize: 12, marginBottom: 16, textAlign: 'center', fontWeight: 500 }}>{error}</div>}

            <button type="submit" disabled={loading || newPassword.length < 8 || newPassword !== confirmPassword}
              style={btnStyle(!loading && newPassword.length >= 8 && newPassword === confirmPassword)}>
              {loading ? 'Saving...' : 'Set Password & Continue'}
            </button>
          </form>
        )}

        {/* Footer */}
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: '#8a9fb0' }}>
          Seniority Healthcare — HIPAA Compliant
        </div>
      </div>
    </div>
  );
}
