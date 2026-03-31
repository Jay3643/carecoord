import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function SetupAccount({ onComplete }) {
  const [step, setStep] = useState('loading'); // loading, setPassword, setup2fa, confirm2fa, done, error
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) { setStep('error'); setError('No invitation token found'); return; }

    api.verifyInvite(token).then(data => {
      setInvite({ ...data, token });
      setEmail(data.email);
      setStep('setPassword');
    }).catch(e => {
      setStep('error');
      setError(e.message || 'Invalid or expired invitation');
    });
  }, []);

  const handleSetPassword = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setError(''); setLoading(true);
    try {
      const data = await api.acceptInvite(invite.token, password);
      setQrCode(data.qrCode);
      setEmail(data.email);
      setStep('setup2fa');
    } catch (e) { setError(e.message || 'Failed to create account'); }
    setLoading(false);
  };

  const handleConfirm2fa = async () => {
    if (totpCode.length !== 6) { setError('Enter the 6-digit code from your authenticator app'); return; }
    setError(''); setLoading(true);
    try {
      await api.confirmSetup2fa(email, totpCode);
      setStep('done');
    } catch (e) { setError(e.message || 'Invalid code'); }
    setLoading(false);
  };

  const cardStyle = { background: '#fff', borderRadius: 16, padding: 40, width: 440, boxShadow: '0 8px 40px rgba(0,0,0,0.1)' };
  const inputStyle = { width: '100%', padding: '12px 16px', border: '1px solid #dadce0', borderRadius: 8, fontSize: 15, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
  const btnStyle = { width: '100%', padding: '14px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0d2137 0%, #143d6b 50%, #1a5e9a 100%)', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/ai-logo.jpg" alt="Seniority" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'contain', marginBottom: 8 }} />
          <div style={{ fontSize: 28, fontWeight: 700, color: '#1e3a4f', marginBottom: 4 }}>Seniority Connect</div>
          <div style={{ fontSize: 13, color: '#8a9fb0' }}>Seniority Healthcare</div>
        </div>

        {step === 'loading' && (
          <div style={{ textAlign: 'center', padding: 40, color: '#8a9fb0' }}>Verifying invitation...</div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <div style={{ color: '#d94040', fontSize: 15, marginBottom: 24 }}>{error}</div>
            <p style={{ color: '#8a9fb0', fontSize: 13 }}>Contact your administrator for a new invitation.</p>
          </div>
        )}

        {step === 'setPassword' && invite && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1e3a4f' }}>Welcome, {invite.name}!</div>
              <div style={{ fontSize: 13, color: '#8a9fb0', marginTop: 4 }}>Set up your account as <strong>{invite.role}</strong></div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={invite.email} disabled style={{ ...inputStyle, background: '#f6f8fa', color: '#8a9fb0' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 8 characters" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSetPassword(); }} placeholder="Re-enter password" style={inputStyle} />
            </div>
            {error && <div style={{ color: '#d94040', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
            <button onClick={handleSetPassword} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Creating account...' : 'Continue'}
            </button>
          </div>
        )}

        {step === 'setup2fa' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1e3a4f' }}>Set Up Two-Factor Authentication</div>
              <div style={{ fontSize: 13, color: '#8a9fb0', marginTop: 4 }}>Scan the QR code with Google Authenticator or Authy</div>
            </div>
            {qrCode && <div style={{ textAlign: 'center', marginBottom: 24 }}><img src={qrCode} alt="2FA QR Code" style={{ width: 200, height: 200 }} /></div>}
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Enter 6-digit code</label>
              <input type="text" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={e => { if (e.key === 'Enter') handleConfirm2fa(); }}
                placeholder="000000" maxLength={6}
                style={{ ...inputStyle, textAlign: 'center', fontSize: 24, letterSpacing: 8, fontFamily: "'IBM Plex Mono', monospace" }} />
            </div>
            {error && <div style={{ color: '#d94040', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
            <button onClick={handleConfirm2fa} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Verifying...' : 'Complete Setup'}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1e3a4f', marginBottom: 8 }}>Account Created!</div>
            <p style={{ color: '#8a9fb0', fontSize: 14, marginBottom: 24 }}>Your account is ready. You can now log in with your email and password.</p>
            <button onClick={() => { window.location.href = '/'; }} style={btnStyle}>Go to Login</button>
          </div>
        )}
      </div>
    </div>
  );
}
