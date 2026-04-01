import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Tour step definitions by role
// ---------------------------------------------------------------------------

const COMMON_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Seniority Connect',
    description:
      'Your all-in-one care coordination hub. This quick tour will walk you through the key features so you can hit the ground running.',
    isWelcome: true,
  },
  {
    id: 'region-queue',
    title: 'Region Queue',
    description:
      'This is your team inbox. New tickets from patients and external contacts land here. Claim a ticket to start working on it.',
    target: '[data-tour="regionQueue"]',
    position: 'right',
  },
  {
    id: 'my-queue',
    title: 'My Queue',
    description:
      'Tickets assigned to you appear here. Unread messages show a red badge so nothing slips through the cracks.',
    target: '[data-tour="personalQueue"]',
    position: 'right',
  },
  {
    id: 'pending-import',
    title: 'Pending Import on Login',
    description:
      'When you sign in, the system checks for new emails addressed to you and shows an import dialog. Select the ones you want and they become tickets automatically.',
    position: 'center',
  },
  {
    id: 'open-tickets',
    title: 'Opening Tickets & Tabs',
    description:
      'Click any ticket to open it in a tab. You can have multiple tickets open at once and switch between them, just like browser tabs.',
    position: 'center',
  },
  {
    id: 'time-clock',
    title: 'Time Clock',
    description:
      'A timer auto-starts when you open a ticket and logs your time. You can stop it manually when you step away. Time data flows to the Activity Dashboard.',
    position: 'center',
  },
  {
    id: 'compose-reply',
    title: 'Compose Reply / Reply All',
    description:
      'Inside a ticket, hit Reply or Reply All to send an email. The rich editor supports formatting, attachments, and email templates.',
    position: 'center',
  },
  {
    id: 'internal-notes',
    title: 'Internal Notes',
    description:
      'Add private notes visible only to your team. Great for documenting follow-ups, supervisor instructions, or handoff context.',
    position: 'center',
  },
  {
    id: 'chat-on-ticket',
    title: 'Start a Chat on Tickets',
    description:
      'Use the Discussion tab inside a ticket for real-time chat with teammates about that specific case.',
    position: 'center',
  },
  {
    id: 'new-message',
    title: 'New Message',
    description:
      'Compose a brand-new outbound email from here. You can minimize the compose window and keep working while your draft waits at the bottom.',
    target: '[data-tour="newMessage"]',
    position: 'right',
  },
  {
    id: 'email-inbox',
    title: 'Email Inbox',
    description:
      'Your connected Gmail inbox lives here. Read, reply, and manage personal emails without leaving the app.',
    target: '[data-tour="personalEmail"]',
    position: 'right',
  },
  {
    id: 'contacts-autocomplete',
    title: 'Contacts Autocomplete',
    description:
      'Start typing a name or email in any To/CC field and the system suggests matching contacts from your organization\u2019s address book.',
    position: 'center',
  },
  {
    id: 'seniority-ai',
    title: 'Seniority AI Assistant',
    description:
      'Your AI-powered helper. Ask questions about a ticket, draft replies, summarize conversations, or look up policy info \u2014 right from the sidebar.',
    target: '[data-tour="seniorityAi"]',
    position: 'right',
  },
  {
    id: 'archive',
    title: 'Archive',
    description:
      'Closed tickets move here. Search and filter to pull up any past case for reference or auditing.',
    target: '[data-tour="archive"]',
    position: 'right',
  },
];

const SUPERVISOR_STEPS = [
  {
    id: 'dashboard',
    title: 'Dashboard Overview',
    description:
      'A bird\u2019s-eye view of queue health: open tickets by region, aging metrics, and coordinator workloads \u2014 all in real time.',
    target: '[data-tour="dashboard"]',
    position: 'right',
  },
  {
    id: 'activity-dashboard',
    title: 'Activity Dashboard & User Audit',
    description:
      'See who\u2019s online, time-on-task breakdowns, and per-user productivity metrics. Great for coaching conversations.',
    target: '[data-tour="activityDashboard"]',
    position: 'right',
  },
  {
    id: 'audit-log',
    title: 'Audit Log',
    description:
      'Every action is logged here with clickable links that jump straight to the relevant ticket. Filter by user, action type, or date range.',
    target: '[data-tour="auditLog"]',
    position: 'right',
  },
  {
    id: 'pull-from-queue',
    title: 'Pull from Queue',
    description:
      'Supervisors can pull tickets from any coordinator\u2019s My Queue back to the Region Queue, or reassign them to another coordinator.',
    position: 'center',
  },
  {
    id: 'bulk-reassign',
    title: 'Bulk Reassign',
    description:
      'Select multiple tickets and reassign them in one action \u2014 useful for load balancing or when a coordinator is out.',
    position: 'center',
  },
];

const ADMIN_STEPS = [
  {
    id: 'admin-panel',
    title: 'Admin Panel',
    description:
      'Manage users, regions, email aliases, and tags from a single control center. Changes take effect immediately.',
    target: '[data-tour="admin"]',
    position: 'right',
  },
  {
    id: 'invite-users',
    title: 'Inviting New Users',
    description:
      'Add coordinators, supervisors, or admins by email. They receive a setup link to create their password and connect Gmail.',
    position: 'center',
  },
  {
    id: 'manage-regions',
    title: 'Managing Regions & Aliases',
    description:
      'Create regions, assign coordinators, and configure the email aliases that route inbound mail to each region\u2019s queue.',
    position: 'center',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStepsForRole(role) {
  const steps = [...COMMON_STEPS];
  if (role === 'supervisor' || role === 'admin') {
    steps.push(...SUPERVISOR_STEPS);
  }
  if (role === 'admin') {
    steps.push(...ADMIN_STEPS);
  }
  return steps;
}

function getTooltipPosition(targetEl, position, cardWidth, cardHeight) {
  if (!targetEl) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  const rect = targetEl.getBoundingClientRect();
  const margin = 14;

  let style = {};
  switch (position) {
    case 'right':
      style = {
        top: Math.max(8, Math.min(rect.top + rect.height / 2 - cardHeight / 2, window.innerHeight - cardHeight - 8)),
        left: rect.right + margin,
      };
      // Keep card on screen
      if (style.left + cardWidth > window.innerWidth - 8) {
        style.left = rect.left - cardWidth - margin;
      }
      break;
    case 'left':
      style = {
        top: Math.max(8, Math.min(rect.top + rect.height / 2 - cardHeight / 2, window.innerHeight - cardHeight - 8)),
        left: rect.left - cardWidth - margin,
      };
      if (style.left < 8) {
        style.left = rect.right + margin;
      }
      break;
    case 'bottom':
      style = {
        top: rect.bottom + margin,
        left: Math.max(8, Math.min(rect.left + rect.width / 2 - cardWidth / 2, window.innerWidth - cardWidth - 8)),
      };
      break;
    case 'top':
      style = {
        top: rect.top - cardHeight - margin,
        left: Math.max(8, Math.min(rect.left + rect.width / 2 - cardWidth / 2, window.innerWidth - cardWidth - 8)),
      };
      break;
    default:
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  return style;
}

// ---------------------------------------------------------------------------
// Styles (object map keeps things tidy and easy to tweak)
// ---------------------------------------------------------------------------

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(0,0,0,0.6)',
    transition: 'opacity 0.3s ease',
  },
  card: {
    position: 'fixed', zIndex: 10002,
    background: '#f0f4f9',
    borderRadius: 14,
    border: '1px solid #c0d0e4',
    boxShadow: '0 12px 48px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.1)',
    padding: '28px 32px 22px',
    maxWidth: 420,
    width: '92vw',
    fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
    color: '#1e3a4f',
    transition: 'top 0.35s cubic-bezier(.4,0,.2,1), left 0.35s cubic-bezier(.4,0,.2,1), opacity 0.3s ease',
  },
  welcomeCard: {
    position: 'fixed', zIndex: 10002,
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    background: '#f0f4f9',
    borderRadius: 14,
    border: '1px solid #c0d0e4',
    boxShadow: '0 16px 64px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.1)',
    padding: '40px 40px 28px',
    maxWidth: 480,
    width: '92vw',
    fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
    color: '#1e3a4f',
    textAlign: 'center',
    transition: 'opacity 0.35s ease, transform 0.35s cubic-bezier(.4,0,.2,1)',
  },
  title: {
    fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#102f54', lineHeight: 1.3,
  },
  description: {
    fontSize: 13.5, lineHeight: 1.6, color: '#3d5a72', margin: '0 0 20px',
  },
  btnPrimary: {
    padding: '9px 22px', borderRadius: 8, border: 'none',
    background: '#1a5e9a', color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', transition: 'background 0.15s ease',
    fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
  },
  btnSecondary: {
    padding: '9px 22px', borderRadius: 8,
    border: '1px solid #c0d0e4', background: '#dde8f2',
    color: '#1a5e9a', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', transition: 'background 0.15s ease',
    fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
  },
  btnSkip: {
    padding: '9px 16px', borderRadius: 8, border: 'none',
    background: 'transparent', color: '#6b8299', fontSize: 12, fontWeight: 500,
    cursor: 'pointer',
    fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
  },
  dot: (active) => ({
    width: active ? 10 : 7,
    height: 7,
    borderRadius: 99,
    background: active ? '#1a5e9a' : '#c0d0e4',
    transition: 'all 0.25s ease',
    cursor: 'pointer',
  }),
  spotlight: {
    position: 'fixed', zIndex: 10001,
    borderRadius: 8,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
    transition: 'all 0.35s cubic-bezier(.4,0,.2,1)',
    pointerEvents: 'none',
  },
  helpBtn: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    zIndex: 9000,
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: '#1a5e9a',
    color: '#fff',
    border: 'none',
    fontSize: 20,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(26,94,154,0.35)',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
  },
  stepCounter: {
    fontSize: 11, fontWeight: 600, color: '#8a9fb0', letterSpacing: 0.5, marginBottom: 6,
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingTour({ currentUser, onComplete }) {
  const role = currentUser?.role || 'coordinator';
  const steps = useMemo(() => getStepsForRole(role), [role]);

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [cardPos, setCardPos] = useState(null);
  const [spotlightRect, setSpotlightRect] = useState(null);
  const [fadeIn, setFadeIn] = useState(false);
  const cardRef = useRef(null);
  const resizeTimer = useRef(null);

  const step = steps[stepIndex] || steps[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  // Check localStorage on mount
  useEffect(() => {
    const done = localStorage.getItem('onboarding_completed');
    if (!done) {
      setActive(true);
      setStepIndex(0);
    }
  }, []);

  // Fade-in on activation
  useEffect(() => {
    if (active) {
      // Small delay so the DOM renders before we trigger the CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setFadeIn(true));
      });
    } else {
      setFadeIn(false);
    }
  }, [active]);

  // Position the card whenever step changes
  const positionCard = useCallback(() => {
    if (!active) return;
    const current = steps[stepIndex];
    if (!current) return;

    if (current.isWelcome || current.position === 'center' || !current.target) {
      setCardPos(null);
      setSpotlightRect(null);
      return;
    }

    const el = document.querySelector(current.target);
    if (!el) {
      setCardPos(null);
      setSpotlightRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    const pad = 6;
    setSpotlightRect({
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    });

    // Estimate card dimensions (or measure after render)
    const cardW = Math.min(420, window.innerWidth * 0.92);
    const cardH = cardRef.current ? cardRef.current.offsetHeight : 220;
    const pos = getTooltipPosition(el, current.position, cardW, cardH);
    setCardPos(pos);
  }, [active, stepIndex, steps]);

  useEffect(() => {
    positionCard();
  }, [positionCard]);

  // Re-position on resize / scroll
  useEffect(() => {
    if (!active) return;
    const handler = () => {
      clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(positionCard, 80);
    };
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [active, positionCard]);

  // After card renders, re-calc position once to account for actual height
  useEffect(() => {
    if (active && cardRef.current) {
      const frame = requestAnimationFrame(positionCard);
      return () => cancelAnimationFrame(frame);
    }
  }, [active, stepIndex, positionCard]);

  // ------ Actions ------

  const finishTour = useCallback(() => {
    localStorage.setItem('onboarding_completed', 'true');
    setFadeIn(false);
    setTimeout(() => {
      setActive(false);
      setStepIndex(0);
      if (onComplete) onComplete();
    }, 300);
  }, [onComplete]);

  const goNext = useCallback(() => {
    if (isLast) {
      finishTour();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [isLast, finishTour]);

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const skipTour = useCallback(() => {
    finishTour();
  }, [finishTour]);

  const restartTour = useCallback(() => {
    localStorage.removeItem('onboarding_completed');
    setStepIndex(0);
    setActive(true);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') goNext();
      else if (e.key === 'ArrowLeft') goBack();
      else if (e.key === 'Escape') skipTour();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, goNext, goBack, skipTour]);

  // ------ Render ------

  if (!active) {
    // Help button to restart tour
    return (
      <button
        style={S.helpBtn}
        title="Restart onboarding tour"
        onClick={restartTour}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(26,94,154,0.5)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(26,94,154,0.35)'; }}
      >
        ?
      </button>
    );
  }

  // Progress dots
  const renderDots = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 4 }}>
      {steps.map((_, i) => (
        <span
          key={i}
          style={S.dot(i === stepIndex)}
          onClick={() => setStepIndex(i)}
        />
      ))}
    </div>
  );

  // Welcome screen (centered, with logo)
  if (step.isWelcome) {
    return (
      <>
        <div style={{ ...S.overlay, opacity: fadeIn ? 1 : 0 }} onClick={skipTour} />
        <div
          ref={cardRef}
          style={{
            ...S.welcomeCard,
            opacity: fadeIn ? 1 : 0,
            transform: fadeIn ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.95)',
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <img
              src="/ai-logo.jpg"
              alt="Seniority"
              style={{ width: 60, height: 60, borderRadius: 12, objectFit: 'contain', boxShadow: '0 2px 12px rgba(0,0,0,0.1)' }}
            />
          </div>
          <h2 style={{ ...S.title, fontSize: 22, marginBottom: 6 }}>{step.title}</h2>
          <p style={{ fontSize: 12, color: '#6b8299', marginBottom: 14, fontWeight: 500 }}>
            {role === 'admin' ? 'Admin' : role === 'supervisor' ? 'Supervisor' : 'Coordinator'} Tour
            {' \u2022 '}{steps.length} steps
          </p>
          <p style={{ ...S.description, maxWidth: 360, margin: '0 auto 28px' }}>{step.description}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <button
              style={{ ...S.btnPrimary, padding: '11px 36px', fontSize: 14 }}
              onClick={goNext}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#145080'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#1a5e9a'; }}
            >
              Start Tour
            </button>
            <button
              style={S.btnSkip}
              onClick={skipTour}
            >
              Skip tour
            </button>
          </div>
          {renderDots()}
        </div>
      </>
    );
  }

  // Standard step card (possibly positioned near a target)
  const isCentered = !cardPos;

  return (
    <>
      {/* Overlay */}
      <div style={{ ...S.overlay, opacity: fadeIn ? 1 : 0, background: spotlightRect ? 'transparent' : 'rgba(0,0,0,0.6)' }} onClick={skipTour} />

      {/* Spotlight cutout */}
      {spotlightRect && (
        <div
          style={{
            ...S.spotlight,
            top: spotlightRect.top,
            left: spotlightRect.left,
            width: spotlightRect.width,
            height: spotlightRect.height,
          }}
        />
      )}

      {/* Card */}
      <div
        ref={cardRef}
        style={{
          ...S.card,
          opacity: fadeIn ? 1 : 0,
          ...(isCentered
            ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
            : { top: cardPos.top, left: cardPos.left, transform: cardPos.transform || 'none' }
          ),
        }}
      >
        {/* Step counter */}
        <div style={S.stepCounter}>
          Step {stepIndex + 1} of {steps.length}
        </div>

        <h3 style={S.title}>{step.title}</h3>
        <p style={S.description}>{step.description}</p>

        {/* Buttons row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button style={S.btnSkip} onClick={skipTour}>
            Skip
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isFirst && (
              <button
                style={S.btnSecondary}
                onClick={goBack}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#ccdaea'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#dde8f2'; }}
              >
                Back
              </button>
            )}
            <button
              style={S.btnPrimary}
              onClick={goNext}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#145080'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#1a5e9a'; }}
            >
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>

        {/* Progress dots */}
        {renderDots()}
      </div>
    </>
  );
}
