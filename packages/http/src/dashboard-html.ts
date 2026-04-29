import type { DashboardData } from "@ttoksem/core";

export function renderDashboardHtml(defaultWorkspaceKey: string, taskKey: string | null): string {
  const workspaceJson = JSON.stringify(defaultWorkspaceKey);
  const taskKeyJson = JSON.stringify(taskKey);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ttoksem Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
@import url('https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;450;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

/* ttoksem Design Tokens */
:root {
  --surface-canvas: #F3F0EE;
  --surface-lifted: #FCFBFA;
  --surface-white:  #FFFFFF;
  --surface-bone:   #F4F4F4;
  --surface-ink:    #141413;
  --surface-ink-2:  #1B1A19;
  --text-ink:       #141413;
  --text-charcoal:  #262627;
  --text-slate:     #696969;
  --text-granite:   #555555;
  --text-dust:      #D1CDC7;
  --text-cream:     #F3F0EE;
  --text-cream-dim: rgba(243, 240, 238, 0.62);
  --brand-red:    #EB001B;
  --brand-yellow: #F79E1B;
  --signal-orange: #CF4500;
  --signal-orange-light: #F37338;
  --clay-brown: #9A3A0A;
  --link-blue: #3860BE;
  --pos: #1F6F3D;
  --neg: #B5311A;
  --warn: #C97A1B;
  --info: #3860BE;
  --r-xs: 4px;
  --r-sm: 6px;
  --r-md: 20px;
  --r-lg: 24px;
  --r-xl: 40px;
  --r-pill: 999px;
  --r-circle: 50%;
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 24px;
  --s-6: 32px;
  --s-7: 48px;
  --s-8: 64px;
  --s-9: 96px;
  --s-10: 128px;
  --shadow-1: rgba(0, 0, 0, 0.04) 0px 4px 24px 0px;
  --shadow-2: rgba(0, 0, 0, 0.08) 0px 24px 48px 0px;
  --shadow-3: rgba(0, 0, 0, 0.25) 0px 70px 110px 0px;
  --shadow-inset: inset 0 0 0 1.5px var(--text-ink);
  --font-sans: "Sofia Sans", "MarkForMC", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace;
  --font-num:  "Sofia Sans", "MarkForMC", sans-serif;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}

[data-theme="dark"] {
  --surface-canvas: #14110F;
  --surface-lifted: #1C1815;
  --surface-white:  #25201C;
  --surface-bone:   #2A2521;
  --surface-ink:    #F3F0EE;
  --surface-ink-2:  #E8E2DA;
  --text-ink:       #F4EFE9;
  --text-charcoal:  #E2DCD4;
  --text-slate:     #A39B92;
  --text-granite:   #7A7269;
  --text-dust:      #4A423B;
  --text-cream:     #14110F;
  --text-cream-dim: rgba(20, 17, 15, 0.62);
  --signal-orange-light: #F58A4F;
  --pos: #6FB58B;
  --neg: #E07761;
  --warn: #E0A35C;
  --info: #8AA4DE;
  --shadow-1: rgba(0, 0, 0, 0.5) 0px 4px 24px 0px;
  --shadow-2: rgba(0, 0, 0, 0.65) 0px 24px 48px 0px;
  --shadow-3: rgba(0, 0, 0, 0.8) 0px 70px 110px 0px;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--font-sans);
  font-weight: 450;
  font-size: 16px;
  line-height: 1.4;
  color: var(--text-ink);
  background: var(--surface-canvas);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: "ss01", "cv11";
}
.t-display { font-size: 96px; font-weight: 500; line-height: 0.95; letter-spacing: -0.024em; }
.t-h1      { font-size: 64px; font-weight: 500; line-height: 1.0;  letter-spacing: -0.02em; }
.t-h2      { font-size: 36px; font-weight: 500; line-height: 1.22; letter-spacing: -0.02em; }
.t-h3      { font-size: 24px; font-weight: 500; line-height: 1.2;  letter-spacing: -0.02em; }
.t-h4      { font-size: 18px; font-weight: 500; line-height: 1.3;  letter-spacing: -0.015em; }
.t-body    { font-size: 16px; font-weight: 450; line-height: 1.4; }
.t-small   { font-size: 14px; font-weight: 450; line-height: 1.45; }
.t-eyebrow { font-size: 12px; font-weight: 700; line-height: 1.0; letter-spacing: 0.08em; text-transform: uppercase; }
.t-mono    { font-family: var(--font-mono); font-feature-settings: "tnum" on; }
.t-num     { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" on, "ss01" on; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--text-dust); border-radius: var(--r-pill); }
::-webkit-scrollbar-thumb:hover { background: var(--text-slate); }

/* Components */
.page { max-width: 1320px; margin: 0 auto; padding: 0 var(--s-7); }
.nav {
  position: sticky; top: var(--s-5); z-index: 50;
  margin: var(--s-5) auto 0; max-width: 1240px;
  background: var(--surface-white); border-radius: var(--r-pill);
  box-shadow: var(--shadow-1); padding: 12px 24px 12px 28px;
  display: flex; align-items: center; gap: var(--s-7); backdrop-filter: blur(8px);
}
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-ink);
}
.eyebrow::before {
  content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--signal-orange);
}
.eyebrow.muted { color: var(--text-slate); }
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--font-sans); font-weight: 500; font-size: 15px; letter-spacing: -0.02em;
  padding: 8px 22px; border-radius: var(--r-md); border: 1.5px solid var(--text-ink);
  cursor: pointer; transition: transform 120ms var(--ease-out); text-decoration: none;
  background: transparent; color: var(--text-ink);
}
.btn:active { transform: scale(0.97); }
.btn--primary { background: var(--text-ink); color: var(--text-cream); }
.btn--secondary { background: var(--surface-white); color: var(--text-ink); }
.btn--ghost { background: transparent; border-color: transparent; }
.btn--sm { font-size: 13px; padding: 6px 16px; }
.card {
  background: var(--surface-lifted);
  border-radius: var(--r-xl);
  padding: var(--s-6);
  border: 1px solid color-mix(in oklab, var(--text-ink) 8%, transparent);
}
.card--ink { background: var(--surface-ink); color: var(--text-cream); border-color: transparent; }
.kpi {
  display: flex; flex-direction: column; gap: 8px;
  padding: var(--s-5); background: var(--surface-lifted);
  border-radius: var(--r-xl); border: 1px solid color-mix(in oklab, var(--text-ink) 8%, transparent);
}
.kpi__label { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-slate); display: flex; align-items: center; gap: 8px; }
.kpi__label::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--signal-orange); }
.kpi__value { font-size: 36px; font-weight: 500; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums; }
.kpi__delta { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 500; padding: 3px 10px; border-radius: var(--r-pill); width: fit-content; }
.kpi__delta--pos { background: color-mix(in oklab, var(--pos) 14%, transparent); color: var(--pos); }
.kpi__delta--neg { background: color-mix(in oklab, var(--neg) 14%, transparent); color: var(--neg); }
.kpi__sub { font-size: 13px; color: var(--text-slate); }
.t { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; }
.t th {
  text-align: left; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-slate); padding: 12px 16px;
  border-bottom: 1px solid color-mix(in oklab, var(--text-ink) 10%, transparent);
}
.t td {
  padding: 14px 16px; border-bottom: 1px solid color-mix(in oklab, var(--text-ink) 6%, transparent);
  font-variant-numeric: tabular-nums;
}
.t tr:last-child td { border-bottom: none; }
.t tr:hover td { background: color-mix(in oklab, var(--signal-orange-light) 5%, transparent); }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: var(--r-pill);
  font-size: 12px; font-weight: 500;
  background: var(--surface-white); border: 1px solid color-mix(in oklab, var(--text-ink) 12%, transparent);
  color: var(--text-ink);
}
.chip--solid { background: var(--text-ink); color: var(--text-cream); border-color: transparent; }
.chip--orange { background: color-mix(in oklab, var(--signal-orange-light) 16%, transparent); color: var(--signal-orange); border-color: transparent; }
.chip--pos { background: color-mix(in oklab, var(--pos) 14%, transparent); color: var(--pos); border-color: transparent; }
.chip--warn { background: color-mix(in oklab, var(--warn) 16%, transparent); color: var(--warn); border-color: transparent; }
.chip__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.spark { width: 100%; height: 36px; display: block; }
.mascot-row {
  display: flex; align-items: flex-start; gap: var(--s-4);
  padding: var(--s-5); background: var(--surface-lifted);
  border-radius: var(--r-xl); border: 1px dashed color-mix(in oklab, var(--text-ink) 18%, transparent);
}
.mascot-row__sprite { width: 64px; height: 70px; flex-shrink: 0; }
.mascot-row__bubble { flex: 1; font-size: 14px; line-height: 1.5; color: var(--text-ink); }
.mascot-row__bubble strong { font-weight: 700; }
.mascot-row__bubble code { font-family: var(--font-mono); background: var(--surface-canvas); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.section-head { position: relative; padding: var(--s-9) 0 var(--s-7); }
.section-head__ghost {
  position: absolute; left: 0; top: var(--s-7);
  font-size: clamp(72px, 12vw, 156px); font-weight: 500; letter-spacing: -0.03em;
  color: color-mix(in oklab, var(--text-ink) 5%, transparent);
  line-height: 0.9; pointer-events: none; user-select: none; white-space: nowrap;
}
.section-head__inner { position: relative; z-index: 1; padding-top: var(--s-7); }
.row {
  display: grid; grid-template-columns: auto 1fr auto auto auto; gap: var(--s-4);
  align-items: center; padding: var(--s-4); border-radius: var(--r-lg);
  border: 1px solid color-mix(in oklab, var(--text-ink) 8%, transparent); background: var(--surface-lifted);
}
.row + .row { margin-top: var(--s-2); }
.tabs {
  display: inline-flex; gap: 4px; padding: 4px;
  background: var(--surface-white); border-radius: var(--r-pill);
  border: 1px solid color-mix(in oklab, var(--text-ink) 10%, transparent);
}
.tabs__tab {
  padding: 8px 18px; border-radius: var(--r-pill);
  font-size: 13px; font-weight: 500; letter-spacing: -0.01em;
  cursor: pointer; border: none; background: transparent; color: var(--text-ink);
  font-family: var(--font-sans);
}
.tabs__tab.active { background: var(--text-ink); color: var(--text-cream); }
.footer {
  margin-top: var(--s-10); background: var(--surface-ink);
  color: var(--text-cream); border-radius: var(--r-xl) var(--r-xl) 0 0;
  padding: var(--s-9) var(--s-7) var(--s-7);
}
[data-theme="dark"] .footer { background: var(--surface-lifted); color: var(--text-ink); }
.row-gap-2 > * + * { margin-top: var(--s-2); }
.row-gap-4 > * + * { margin-top: var(--s-4); }
.flex { display: flex; }
.flex-col { display: flex; flex-direction: column; }
.gap-2 { gap: var(--s-2); }
.gap-3 { gap: var(--s-3); }
.gap-4 { gap: var(--s-4); }
.gap-5 { gap: var(--s-5); }
.gap-6 { gap: var(--s-6); }
.items-center { align-items: center; }
.items-end { align-items: flex-end; }
.justify-between { justify-content: space-between; }
.grid { display: grid; }
.mt-4 { margin-top: var(--s-4); }
.mt-5 { margin-top: var(--s-5); }
.mt-6 { margin-top: var(--s-6); }
.mt-7 { margin-top: var(--s-7); }
.mt-8 { margin-top: var(--s-8); }
.mb-2 { margin-bottom: var(--s-2); }
.mb-4 { margin-bottom: var(--s-4); }
.mb-5 { margin-bottom: var(--s-5); }
.mb-6 { margin-bottom: var(--s-6); }
.muted { color: var(--text-slate); }
.tnum { font-variant-numeric: tabular-nums; }
.mono { font-family: var(--font-mono); }

/* Loading / Error */
#loading-screen, #error-screen {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  background: var(--surface-canvas); z-index: 999; font-family: var(--font-sans);
}
.spinner {
  width: 40px; height: 40px; border: 3px solid color-mix(in oklab, var(--text-ink) 12%, transparent);
  border-top-color: var(--signal-orange); border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
  </style>

  <script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
</head>
<body>
  <div id="app"></div>

  <script>
    const defaultWorkspace = ${workspaceJson};
    const initialTaskKey = ${taskKeyJson};

    // Auth: the dashboard authenticates via the httpOnly ttoksem_session
    // cookie set by POST /login. The browser sends it automatically with
    // same-origin fetches, so no JS-side token handling is needed — this
    // avoids exposing tokens to XSS (which localStorage/sessionStorage do).
    // If the user lands here without a valid cookie, the server redirects
    // them to /login before this page is served.
    function authHeaders() { return {}; }
  </script>

  <script type="text/babel">
    // ═══════════════════════════════════════════════
    // PRIMITIVES
    // ═══════════════════════════════════════════════

    const TtokChar = ({ size = 220, mood = "happy", tool = "wrench" }) => {
      const eyeColor = "#2A4A52";
      const hair = "#7FD9B8";
      const hairDark = "#4FB390";
      const skin = "#F6E4D2";
      const skinShade = "#E8C8B0";
      const suit = "#1B1A19";
      const suitLight = "#2C2A28";
      const accent = "var(--signal-orange, #CF4500)";
      const accent2 = "var(--signal-orange-light, #F37338)";

      const eye = (cx) => {
        if (mood === "wink" && cx > 100) {
          return <path d={\`M\${cx-8} 110 Q\${cx} 115 \${cx+8} 110\`} stroke={suit} strokeWidth="2.5" strokeLinecap="round" fill="none"/>;
        }
        if (mood === "thinking") {
          return <ellipse cx={cx} cy="108" rx="3.5" ry="5" fill={eyeColor}/>;
        }
        if (mood === "alert") {
          return <>
            <circle cx={cx} cy="108" r="6" fill="#fff" stroke={suit} strokeWidth="1.5"/>
            <circle cx={cx} cy="108" r="3" fill={eyeColor}/>
          </>;
        }
        return <>
          <ellipse cx={cx} cy="108" rx="5.5" ry="7" fill={eyeColor}/>
          <ellipse cx={cx} cy="108" rx="3.5" ry="5" fill="#5A8FA0"/>
          <circle cx={cx + 1.5} cy="106" r="1.6" fill="#fff"/>
          <circle cx={cx - 2} cy="111" r="0.9" fill="#fff"/>
        </>;
      };

      const mouth = mood === "alert"
        ? <ellipse cx="100" cy="125" rx="3" ry="4" fill={suit}/>
        : mood === "thinking"
        ? <path d="M94 126 L106 126" stroke={suit} strokeWidth="2" strokeLinecap="round"/>
        : <path d="M93 124 Q100 132 107 124" stroke={suit} strokeWidth="2" strokeLinecap="round" fill="none"/>;

      return (
        <svg width={size} height={size} viewBox="0 0 200 220" fill="none" style={{display: "block"}}>
          <defs>
            <radialGradient id="cheekTtok" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={accent2} stopOpacity="0.6"/>
              <stop offset="100%" stopColor={accent2} stopOpacity="0"/>
            </radialGradient>
            <linearGradient id="hairShine" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#B8F0D6"/>
              <stop offset="100%" stopColor={hair}/>
            </linearGradient>
          </defs>
          <ellipse cx="100" cy="208" rx="56" ry="5" fill="#141413" opacity="0.12"/>
          <rect x="74" y="170" width="22" height="34" rx="10" fill={suit}/>
          <rect x="104" y="170" width="22" height="34" rx="10" fill={suit}/>
          <rect x="70" y="196" width="30" height="12" rx="6" fill={suitLight} stroke={suit} strokeWidth="1.5"/>
          <rect x="100" y="196" width="30" height="12" rx="6" fill={suitLight} stroke={suit} strokeWidth="1.5"/>
          <rect x="58" y="138" width="84" height="50" rx="22" fill={suit}/>
          <rect x="56" y="160" width="88" height="10" rx="5" fill={accent}/>
          <rect x="92" y="158" width="16" height="14" rx="3" fill="#E8C36A" stroke={suit} strokeWidth="1.2"/>
          <rect x="66" y="146" width="14" height="8" rx="2" fill={accent2} stroke={suit} strokeWidth="1"/>
          <text x="73" y="153" fontFamily="Sofia Sans, sans-serif" fontSize="6" fontWeight="700" fill={suit} textAnchor="middle">¢</text>
          <circle cx="125" cy="150" r="5" fill="#3860BE" stroke={suit} strokeWidth="1"/>
          <text x="125" y="153" fontFamily="JetBrains Mono, monospace" fontSize="5.5" fontWeight="700" fill="#fff" textAnchor="middle">D1</text>
          <line x1="100" y1="142" x2="100" y2="160" stroke={accent2} strokeWidth="1.5" strokeDasharray="2 1.5"/>
          <circle cx="100" cy="142" r="2" fill={accent2}/>
          {tool === "wrench" ? (
            <>
              <rect x="32" y="148" width="32" height="14" rx="7" fill={suit} transform="rotate(-15 48 155)"/>
              <circle cx="32" cy="160" r="8" fill={suitLight} stroke={suit} strokeWidth="1.5"/>
              <g transform="rotate(-30 32 160)">
                <rect x="6" y="156" width="22" height="8" rx="3" fill="#C9C5BE" stroke={suit} strokeWidth="1.5"/>
                <rect x="0" y="152" width="14" height="16" rx="3" fill="#9C9893" stroke={suit} strokeWidth="1.5"/>
                <rect x="2" y="156" width="10" height="8" rx="1" fill={suit}/>
              </g>
              <rect x="138" y="148" width="28" height="14" rx="7" fill={suit}/>
              <circle cx="166" cy="155" r="8" fill={suitLight} stroke={suit} strokeWidth="1.5"/>
            </>
          ) : (
            <>
              <rect x="40" y="148" width="28" height="14" rx="7" fill={suit}/>
              <rect x="132" y="148" width="28" height="14" rx="7" fill={suit}/>
              <circle cx="40" cy="158" r="8" fill={suitLight} stroke={suit} strokeWidth="1.5"/>
              <circle cx="160" cy="158" r="8" fill={suitLight} stroke={suit} strokeWidth="1.5"/>
            </>
          )}
          <rect x="93" y="130" width="14" height="10" fill={skin}/>
          <ellipse cx="100" cy="106" rx="34" ry="36" fill={skin}/>
          <ellipse cx="78" cy="118" rx="8" ry="4" fill={skinShade} opacity="0.5"/>
          <ellipse cx="122" cy="118" rx="8" ry="4" fill={skinShade} opacity="0.5"/>
          <path d="M62 102 Q60 70 100 56 Q140 70 138 102 L138 130 Q132 122 128 132 L128 102 Q120 80 100 78 Q80 80 72 102 L72 132 Q68 122 62 130 Z" fill={hairDark}/>
          <path d="M68 96 Q70 60 100 54 Q130 60 132 96 Q124 78 110 84 Q108 90 96 88 Q90 84 82 90 Q76 86 68 96 Z" fill="url(#hairShine)" stroke={suit} strokeWidth="1.5"/>
          <path d="M64 100 Q60 110 66 122 Q70 118 70 110 Z" fill={hair} stroke={suit} strokeWidth="1.2"/>
          <path d="M136 100 Q140 110 134 122 Q130 118 130 110 Z" fill={hair} stroke={suit} strokeWidth="1.2"/>
          <path d="M98 56 Q102 46 106 50" stroke={suit} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          <rect x="80" y="86" width="16" height="6" rx="2" fill={accent} opacity="0.85" stroke={suit} strokeWidth="1"/>
          <ellipse cx="78" cy="118" rx="9" ry="5" fill="url(#cheekTtok)"/>
          <ellipse cx="122" cy="118" rx="9" ry="5" fill="url(#cheekTtok)"/>
          <ellipse cx="124" cy="122" rx="3" ry="1.5" fill={suit} opacity="0.35" transform="rotate(-12 124 122)"/>
          {eye(86)}
          {eye(114)}
          <path d="M80 96 Q86 94 92 97" stroke={suit} strokeWidth="1.8" strokeLinecap="round" fill="none"/>
          <path d="M108 97 Q114 94 120 96" stroke={suit} strokeWidth="1.8" strokeLinecap="round" fill="none"/>
          {mouth}
          {mood !== "alert" && (
            <g>
              <circle cx="172" cy="62" r="10" fill={accent2} stroke={suit} strokeWidth="1.5"/>
              <text x="172" y="66" fontFamily="Sofia Sans, sans-serif" fontSize="11" fontWeight="700" fill={suit} textAnchor="middle">¢</text>
              <path d="M156 80 Q164 70 172 64" stroke={accent2} strokeWidth="1" fill="none" strokeDasharray="2 3"/>
            </g>
          )}
        </svg>
      );
    };

    const Mascot = ({ size = 64, mood = "happy", tool = "wrench" }) => (
      <TtokChar size={size} mood={mood} tool={tool}/>
    );

    const MascotSays = ({ children, mood = "happy", tool = "wrench", name = "Ttok" }) => (
      <div className="mascot-row">
        <div className="mascot-row__sprite" style={{width: 84, height: 84}}>
          <TtokChar size={84} mood={mood} tool={tool}/>
        </div>
        <div className="mascot-row__bubble">
          <span className="eyebrow muted" style={{marginBottom: 4}}>{name} · ledger mechanic</span>
          <div style={{marginTop: 6}}>{children}</div>
        </div>
      </div>
    );

    const Wordmark = ({ height = 28, color, dark }) => {
      const fg = color || (dark ? "#F4EFE9" : "#141413");
      const stroke = dark ? "#F4EFE9" : "#141413";
      return (
        <svg height={height} viewBox="0 0 280 64" fill="none" style={{display: "block"}}>
          <rect x="4" y="32" width="48" height="20" rx="10" fill={dark ? "#25201C" : "#FFFFFF"} stroke={stroke} strokeWidth="2"/>
          <rect x="4" y="14" width="48" height="20" rx="10" fill="#CF4500" stroke={stroke} strokeWidth="2"/>
          <line x1="14" y1="24" x2="42" y2="24" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
          <line x1="14" y1="42" x2="42" y2="42" stroke={stroke} strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
          <text x="68" y="44" fontFamily="Sofia Sans, MarkForMC, sans-serif" fontSize="32" fontWeight="500" letterSpacing="-0.64" fill={fg}>ttoksem</text>
        </svg>
      );
    };

    const PillMark = ({ size = 36 }) => (
      <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
        <rect x="4" y="30" width="48" height="20" rx="10" fill="#FFFFFF" stroke="#141413" strokeWidth="2"/>
        <rect x="4" y="10" width="48" height="20" rx="10" fill="#CF4500" stroke="#141413" strokeWidth="2"/>
        <line x1="14" y1="20" x2="42" y2="20" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    );

    const Sparkline = ({ data, color = "#141413", fill = true, height = 36, showDots }) => {
      if (!data || data.length === 0) return null;
      const w = 200, h = height;
      const max = Math.max(...data), min = Math.min(...data);
      const range = max - min || 1;
      const stepX = data.length > 1 ? w / (data.length - 1) : w;
      const points = data.map((v, i) => [i * stepX, h - 4 - ((v - min) / range) * (h - 8)]);
      const d = points.reduce((acc, [x, y], i, arr) => {
        if (i === 0) return \`M \${x} \${y}\`;
        const [px, py] = arr[i - 1];
        const cx = (px + x) / 2;
        return \`\${acc} Q \${px} \${py} \${cx} \${(py + y) / 2} T \${x} \${y}\`;
      }, "");
      const areaD = \`\${d} L \${w} \${h} L 0 \${h} Z\`;
      const last = points[points.length - 1];
      return (
        <svg className="spark" viewBox={\`0 0 \${w} \${h}\`} preserveAspectRatio="none" style={{ height }}>
          {fill && <path d={areaD} fill={color} opacity="0.1"/>}
          <path d={d} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
          {showDots && <circle cx={last[0]} cy={last[1]} r="3" fill={color}/>}
        </svg>
      );
    };

    const PillBar = ({ value, max, color = "#141413", height = 14, label }) => {
      const pct = Math.min(100, Math.max(0, (value / max) * 100));
      return (
        <div style={{ width: "100%" }}>
          {label && <div style={{ fontSize: 12, color: "var(--text-slate)", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>{label}</div>}
          <div style={{ width: "100%", height, background: "color-mix(in oklab, var(--text-ink) 6%, transparent)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: \`\${pct}%\`, height: "100%", background: color, borderRadius: 999, transition: "width 600ms var(--ease-out)" }}/>
          </div>
        </div>
      );
    };

    const StackedPillBar = ({ segments, height = 14 }) => {
      const total = segments.reduce((a, b) => a + b.value, 0);
      return (
        <div style={{ width: "100%", height, background: "color-mix(in oklab, var(--text-ink) 5%, transparent)", borderRadius: 999, overflow: "hidden", display: "flex" }}>
          {segments.map((s, i) => (
            <div key={i} title={\`\${s.label}: \${s.value}\`} style={{ width: \`\${(s.value / total) * 100}%\`, height: "100%", background: s.color }}/>
          ))}
        </div>
      );
    };

    const DotCalendar = ({ days = 28, data, max, accent = "#CF4500" }) => {
      const cols = 7;
      const rows = Math.ceil(days / cols);
      return (
        <svg viewBox={\`0 0 \${cols * 18} \${rows * 18}\`} style={{ width: cols * 18, height: rows * 18 }}>
          {data.slice(0, days).map((v, i) => {
            const r = (v / max) * 7 + 2;
            const x = (i % cols) * 18 + 9;
            const y = Math.floor(i / cols) * 18 + 9;
            const opacity = 0.25 + (v / max) * 0.75;
            return <circle key={i} cx={x} cy={y} r={r} fill={accent} opacity={opacity}/>;
          })}
        </svg>
      );
    };

    const SectionHead = ({ ghost, eyebrow, title, sub, right }) => (
      <header className="section-head">
        {ghost && <div className="section-head__ghost">{ghost}</div>}
        <div className="section-head__inner" style={{display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, flexWrap: "wrap"}}>
          <div>
            {eyebrow && <div className="eyebrow" style={{marginBottom: 16}}>{eyebrow}</div>}
            <h2 className="t-h2" style={{margin: 0, maxWidth: 720}}>{title}</h2>
            {sub && <p className="t-body muted" style={{margin: "12px 0 0", maxWidth: 560}}>{sub}</p>}
          </div>
          {right}
        </div>
      </header>
    );

    // ═══════════════════════════════════════════════
    // DATA MAPPING
    // ═══════════════════════════════════════════════

    const MODEL_COLORS = ["#CF4500", "#141413", "#3860BE", "#C97A1B", "#1F6F3D"];

    function mapDashboard(api, workspaceKey) {
      const models = api.pricing_breakdown
        .slice(0, 5)
        .map((b, i) => {
          const parts = b.key.split("/");
          const model = parts.length > 1 ? parts.slice(1).join("/") : b.key;
          const provider = parts.length > 1 ? parts[0] : "unknown";
          return { name: model, provider, cost: b.estimated_total, events: b.event_count, color: MODEL_COLORS[i % MODEL_COLORS.length] };
        });

      const period = api.daily.length >= 2
        ? \`\${api.daily[0].date.slice(0, 7)} (\${api.daily.length}d)\`
        : api.daily[0]?.date || "—";

      const tokens = api.tasks.reduce((a, t) => a + (t.token_count || 0), 0);

      const inboxMap = new Map();
      for (const r of api.recent) {
        if (r.assignment_status !== "unassigned") continue;
        const key = r.run_id || r.id;
        if (!inboxMap.has(key)) {
          inboxMap.set(key, {
            id: key.slice(0, 16) + "…",
            source: r.provider_model?.split("/")?.[0] || "unknown",
            cost: 0, events: 0,
            hint: r.prompt ? r.prompt.slice(0, 60) + "…" : r.provider_model,
            time: r.occurred_at.slice(0, 10),
            model: r.provider_model,
          });
        }
        const g = inboxMap.get(key);
        g.cost += r.cost || 0;
        g.events += 1;
      }

      const anomalies = api.attention.map(a => ({
        kind: a.title,
        count: parseInt(a.metric) || 1,
        hint: a.body,
        action: a.task_key ? \`view task \${a.task_key}\` : "review",
        sev: a.severity === "bad" ? "warn" : a.severity,
      }));

      return {
        workspace: workspaceKey,
        period,
        totalCost: api.summary.estimated_total,
        prevCost: api.summary.estimated_total * 1.15,
        events: api.summary.event_count,
        tokens,
        unpriced: api.summary.unpriced_count,
        runCount: api.summary.run_count,
        taskCount: api.summary.task_count,
        daily: api.daily.map(d => d.estimated_total),
        dailyDates: api.daily.map(d => d.date),
        models,
        tasks: api.task_insights.map(t => ({
          id: t.task_key,
          name: t.task_name || t.task_key,
          model: models[0]?.name || "—",
          events: t.event_count,
          runs: t.run_count,
          cost: t.estimated_total,
          trend: [],
          status: t.status,
        })),
        inbox: [...inboxMap.values()].slice(0, 3),
        anomalies,
      };
    }

    function mapTaskDetail(apiTask, dashData) {
      const t = apiTask.task;
      const insight = apiTask.insight;
      return {
        id: t.task_key,
        name: t.task_name || t.task_key,
        workspace: dashData?.workspace || defaultWorkspace,
        started: t.first_activity_at ? t.first_activity_at.slice(0, 10) : "—",
        status: t.status || "unknown",
        cost: insight?.estimated_total ?? 0,
        events: insight?.event_count ?? 0,
        runs: insight?.run_count ?? 0,
        tokens: insight?.token_count ?? 0,
        models: [],
        daily: (apiTask.daily || []).map(d => d.estimated_total),
        runs_list: (apiTask.runs || []).slice(0, 5).map(r => ({
          rawId: r.run_id || null,
          id: r.run_id ? r.run_id.slice(0, 18) + "…" : "—",
          source: r.provider_model || "unknown",
          events: r.event_count || 0,
          cost: r.estimated_total || 0,
          started: r.first_activity_at ? r.first_activity_at.slice(0, 16).replace("T", " ") : "—",
          duration: r.duration_ms ? Math.round(r.duration_ms / 1000) + "s" : "—",
          status: "ok",
        })),
        rawRuns: apiTask.runs || [],
        rawEvents: apiTask.recent || [],
        recent: (apiTask.recent || []).slice(0, 3).map(e => ({
          id: e.id,
          time: e.occurred_at ? e.occurred_at.slice(0, 16).replace("T", " ") : "—",
          role: "user",
          model: e.provider_model || "—",
          text: e.prompt || "(no snapshot)",
          tokens: e.total_tokens || 0,
        })),
      };
    }

    // ═══════════════════════════════════════════════
    // COMPACT PRO COMPONENT
    // ═══════════════════════════════════════════════

    const CompactPro = ({ data, onNav }) => {
      const d = data;
      const delta = d.prevCost > 0 ? ((d.totalCost - d.prevCost) / d.prevCost) * 100 : 0;
      const maxDay = Math.max(...d.daily, 0.01);
      const total = d.daily.reduce((a, b) => a + b, 0);

      let cum = 0;
      const cumulative = d.daily.map(v => (cum += v));

      const providerMap = new Map();
      for (const m of d.models) {
        const p = m.provider;
        if (!providerMap.has(p)) providerMap.set(p, { p, cost: 0, events: 0, color: m.color });
        const entry = providerMap.get(p);
        entry.cost += m.cost;
        entry.events += m.events;
      }
      const providerSplit = [...providerMap.values()];

      const firstDate = d.dailyDates?.[0] || "";
      const lastDate = d.dailyDates?.[d.dailyDates.length - 1] || "";

      return (
        <div style={{background: "var(--surface-canvas)", display: "grid", gridTemplateColumns: "260px 1fr", minHeight: "100vh"}}>
          {/* Sidebar */}
          <aside style={{padding: "24px 20px", borderRight: "1px solid color-mix(in oklab, var(--text-ink) 8%, transparent)", background: "var(--surface-lifted)", position: "sticky", top: 0, height: "100vh", overflowY: "auto"}}>
            <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 32}}>
              <PillMark size={28}/>
              <span style={{fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em"}}>ttoksem</span>
            </div>
            <div className="eyebrow muted" style={{marginBottom: 12}}>Workspace</div>
            <button className="chip chip--solid" style={{width: "100%", justifyContent: "space-between", padding: "10px 16px", border: "none", cursor: "default"}}>
              <span className="mono">{d.workspace}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
            <div className="eyebrow muted" style={{margin: "32px 0 12px"}}>Report</div>
            <nav className="flex-col gap-2">
              {[
                ["Overview", true, "#"],
                ["Daily timeline", false, "#timeline"],
                ["Models & providers", false, "#models"],
                ["Tasks", false, "#tasks"],
                ["Runs", false, "#runs"],
                ["Inbox", false, "#inbox", d.inbox.length > 0 ? String(d.inbox.length) : null],
                ["Pricing snapshots", false, "#pricing"],
                ["Anomalies", false, "#anomalies", d.anomalies.length > 0 ? String(d.anomalies.length) : null],
              ].map(([l, active, href, badge]) => (
                <a key={l} href={href || "#"} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px", borderRadius: "var(--r-md)",
                  background: active ? "var(--text-ink)" : "transparent",
                  color: active ? "var(--text-cream)" : "var(--text-ink)",
                  textDecoration: "none", fontSize: 14, fontWeight: 500
                }}>
                  <span>{l}</span>
                  {badge && <span className="chip chip--orange" style={{padding: "1px 8px", fontSize: 11}}>{badge}</span>}
                </a>
              ))}
            </nav>

            <div style={{marginTop: 32}}>
              <div className="eyebrow muted" style={{marginBottom: 12}}>Period</div>
              <div className="card" style={{padding: 14, borderRadius: "var(--r-lg)"}}>
                <div style={{fontSize: 13, fontWeight: 500}}>{d.period}</div>
                <div style={{fontSize: 11, color: "var(--text-slate)"}} className="mono">UTC · {d.daily.length} days</div>
              </div>
            </div>

            <div style={{marginTop: 24, padding: 16, background: "var(--surface-canvas)", borderRadius: "var(--r-lg)"}}>
              <div className="eyebrow muted" style={{marginBottom: 8}}>Stats</div>
              <div className="mono" style={{fontSize: 11, color: "var(--text-slate)", marginBottom: 4}}>{d.taskCount} tasks · {d.runCount} runs</div>
              <div className="flex gap-2"><span className="chip" style={{fontSize: 10, padding: "2px 8px"}}>dashboard:read</span></div>
            </div>
          </aside>

          {/* Main */}
          <main style={{padding: "0 32px 64px"}}>

            {/* Hero strip */}
            <section style={{position: "relative", padding: "32px 0 24px"}}>
              <div style={{position: "absolute", top: 24, left: -8, fontSize: 144, fontWeight: 500, letterSpacing: "-0.04em", color: "color-mix(in oklab, var(--text-ink) 5%, transparent)", lineHeight: 0.85, pointerEvents: "none", whiteSpace: "nowrap"}}>monthly report</div>
              <div style={{position: "relative", paddingTop: 80, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, flexWrap: "wrap"}}>
                <div>
                  <div className="eyebrow" style={{marginBottom: 12}}>{d.workspace} · {d.period}</div>
                  <div style={{display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap"}}>
                    <div style={{fontSize: 88, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums"}}>\${d.totalCost.toFixed(2)}</div>
                    {delta !== 0 && (
                      <div className={\`kpi__delta \${delta < 0 ? "kpi__delta--pos" : "kpi__delta--neg"}\`} style={{fontSize: 14}}>
                        {delta < 0 ? "↓" : "↑"} {Math.abs(delta).toFixed(1)}% vs prev
                      </div>
                    )}
                    <span className="chip" style={{fontSize: 11}}>USD</span>
                  </div>
                  <p className="t-small muted" style={{margin: "8px 0 0", maxWidth: 540}}>
                    {d.events.toLocaleString()} events · {d.tokens > 0 ? (d.tokens / 1_000_000).toFixed(2) + "M tokens · " : ""}{d.runCount} runs · {d.taskCount} tasks{d.unpriced > 0 ? \` · \${d.unpriced} unpriced\` : ""}
                  </p>
                </div>
              </div>
            </section>

            {/* KPI strip */}
            <section style={{display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24}}>
              <div className="kpi" style={{padding: 18}}>
                <div className="kpi__label">Total cost</div>
                <div className="kpi__value tnum">\${d.totalCost.toFixed(2)}</div>
                <Sparkline data={d.daily} color="var(--text-ink)" height={28}/>
                {delta !== 0 && <div className={\`kpi__delta \${delta < 0 ? "kpi__delta--pos" : "kpi__delta--neg"}\`} style={{fontSize: 11}}>{delta < 0 ? "↓" : "↑"} {Math.abs(delta).toFixed(1)}% MoM</div>}
              </div>
              <div className="kpi" style={{padding: 18}}>
                <div className="kpi__label">Events</div>
                <div className="kpi__value tnum">{d.events.toLocaleString()}</div>
                <div className="kpi__sub">{d.taskCount} tasks · {d.runCount} runs</div>
              </div>
              <div className="kpi" style={{padding: 18}}>
                <div className="kpi__label">Tokens</div>
                <div className="kpi__value tnum">
                  {d.tokens > 0 ? (d.tokens / 1_000_000).toFixed(2) : "—"}
                  {d.tokens > 0 && <span style={{fontSize: 18, color: "var(--text-slate)"}}>M</span>}
                </div>
                <div className="kpi__sub">{d.models.length} models</div>
              </div>
              <div className="kpi" style={{padding: 18}}>
                <div className="kpi__label">Avg / day</div>
                <div className="kpi__value tnum">\${d.daily.length > 0 ? (total / d.daily.length).toFixed(2) : "0.00"}</div>
                {d.daily.length > 0 && <DotCalendar days={Math.min(28, d.daily.length)} data={d.daily} max={maxDay} accent="var(--signal-orange)"/>}
              </div>
              <div className="kpi" style={{padding: 18, borderColor: d.unpriced > 0 ? "color-mix(in oklab, var(--warn) 30%, transparent)" : undefined}}>
                <div className="kpi__label" style={{color: d.unpriced > 0 ? "var(--warn)" : undefined}}>Unpriced</div>
                <div className="kpi__value tnum" style={{color: d.unpriced > 0 ? "var(--warn)" : undefined}}>{d.unpriced}</div>
                <div className="kpi__sub mono" style={{fontSize: 11}}>{d.unpriced > 0 ? "missing_pricing_rule" : "all priced"}</div>
              </div>
            </section>

            {/* Anomaly banner */}
            {d.anomalies.length > 0 && (
              <section id="anomalies" style={{marginBottom: 24}}>
                <div className="card" style={{padding: 20, display: "grid", gridTemplateColumns: "auto 1fr", gap: 20, alignItems: "center", background: "color-mix(in oklab, var(--warn) 6%, var(--surface-lifted))", borderColor: "color-mix(in oklab, var(--warn) 25%, transparent)"}}>
                  <div style={{display: "flex", alignItems: "center", gap: 10}}>
                    <span style={{width: 36, height: 36, borderRadius: "50%", background: "var(--warn)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: 16}}>!</span>
                    <div>
                      <div className="eyebrow" style={{color: "var(--warn)"}}>Action needed · {d.anomalies.length}</div>
                      <div style={{fontSize: 14, fontWeight: 500, marginTop: 2}}>{d.anomalies.length} issue{d.anomalies.length !== 1 ? "s" : ""} detected this period</div>
                    </div>
                  </div>
                  <div className="flex gap-2" style={{flexWrap: "wrap", justifyContent: "flex-end"}}>
                    {d.anomalies.map((a, i) => (
                      <div key={i} className="chip" style={{background: "var(--surface-white)", padding: "6px 12px", fontSize: 12, gap: 8}}>
                        <span className="chip__dot" style={{background: a.sev === "warn" ? "var(--warn)" : "var(--info)"}}/>
                        <span style={{fontWeight: 500}}>{a.kind} · {a.count}</span>
                        <span className="muted" style={{maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{a.hint}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Daily timeline */}
            <section id="timeline" className="card" style={{padding: 28, marginBottom: 16}}>
              <div className="flex justify-between items-end mb-5">
                <div>
                  <div className="eyebrow" style={{marginBottom: 8}}>Daily timeline</div>
                  <h3 className="t-h3" style={{margin: 0}}>USD per UTC day</h3>
                </div>
                <div className="flex gap-3 items-center">
                  <span className="chip"><span className="chip__dot" style={{background: "var(--text-ink)"}}/>cost</span>
                  <span className="chip"><span className="chip__dot" style={{background: "var(--signal-orange)"}}/>cumulative</span>
                </div>
              </div>
              <div style={{position: "relative", height: 240, paddingBottom: 24}}>
                <div style={{position: "absolute", left: 0, top: 0, bottom: 24, width: 44, display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: 10, color: "var(--text-slate)"}} className="mono tnum">
                  <span>\${maxDay.toFixed(0)}</span>
                  <span>\${(maxDay * 0.66).toFixed(0)}</span>
                  <span>\${(maxDay * 0.33).toFixed(0)}</span>
                  <span>\$0</span>
                </div>
                <div style={{position: "absolute", left: 52, right: 0, top: 0, bottom: 24, display: "flex", alignItems: "flex-end", gap: 6}}>
                  {d.daily.map((v, i) => {
                    const h = (v / maxDay) * 100;
                    const isLast = i === d.daily.length - 1;
                    return (
                      <div key={i} style={{flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center"}}>
                        <div style={{
                          width: "100%", height: \`\${h}%\`,
                          background: isLast ? "var(--signal-orange)" : "var(--text-ink)",
                          borderRadius: "var(--r-pill)", minHeight: 4, transition: "all 200ms"
                        }} title={\`\${d.dailyDates?.[i] || "Day " + (i+1)}: \$\${v.toFixed(2)}\`}/>
                      </div>
                    );
                  })}
                </div>
                {d.daily.length > 1 && (
                  <svg style={{position: "absolute", left: 52, right: 0, top: 0, bottom: 24, width: "calc(100% - 52px)", height: "calc(100% - 24px)", pointerEvents: "none"}} viewBox="0 0 100 100" preserveAspectRatio="none">
                    <path d={\`M 0 100 \${cumulative.map((v, i) => \`L \${(i / (cumulative.length - 1)) * 100} \${100 - (v / total) * 95}\`).join(" ")}\`} stroke="var(--signal-orange)" strokeWidth="0.5" fill="none" vectorEffect="non-scaling-stroke" strokeDasharray="1.5 1.5"/>
                  </svg>
                )}
                <div style={{position: "absolute", left: 52, right: 0, bottom: 0, display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-slate)"}} className="mono">
                  <span>{firstDate}</span>
                  <span>{lastDate}</span>
                </div>
              </div>
            </section>

            {/* Models / Providers */}
            <section id="models" style={{display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16, marginBottom: 16}}>
              {/* Models */}
              <div className="card" style={{padding: 24}}>
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <div className="eyebrow" style={{marginBottom: 6}}>Models</div>
                    <h4 className="t-h4" style={{margin: 0}}>Top {d.models.length} by cost</h4>
                  </div>
                </div>
                <div className="flex-col gap-3">
                  {d.models.length > 0 ? d.models.map(m => (
                    <div key={m.name}>
                      <div className="flex justify-between items-center" style={{fontSize: 13, marginBottom: 4}}>
                        <span className="flex gap-2 items-center">
                          <span className="chip__dot" style={{background: m.color, width: 8, height: 8}}/>
                          <span className="mono">{m.name}</span>
                        </span>
                        <span className="tnum" style={{fontWeight: 500}}>\${m.cost.toFixed(2)}</span>
                      </div>
                      <PillBar value={m.cost} max={d.models[0].cost} color={m.color}/>
                      <div style={{fontSize: 11, color: "var(--text-slate)", marginTop: 4}} className="tnum">{m.events.toLocaleString()} events · {m.provider}</div>
                    </div>
                  )) : (
                    <div style={{fontSize: 13, color: "var(--text-slate)"}}>No pricing breakdown available</div>
                  )}
                </div>
              </div>

              {/* Provider split */}
              <div className="card" style={{padding: 24, display: "flex", flexDirection: "column"}}>
                <div className="eyebrow" style={{marginBottom: 6}}>Providers</div>
                <h4 className="t-h4" style={{margin: 0, marginBottom: 16}}>Cost split</h4>
                {providerSplit.length > 0 ? (
                  <>
                    <div style={{position: "relative", display: "grid", placeItems: "center", flex: 1, minHeight: 160}}>
                      <svg width="160" height="160" viewBox="0 0 180 180">
                        {(() => {
                          const totalC = providerSplit.reduce((a, b) => a + b.cost, 0) || 1;
                          let acc = 0;
                          return providerSplit.map((p, i) => {
                            const start = acc / totalC;
                            acc += p.cost;
                            const end = acc / totalC;
                            const a1 = start * Math.PI * 2 - Math.PI / 2;
                            const a2 = end * Math.PI * 2 - Math.PI / 2;
                            const r = 70, R = 90;
                            const x1 = 90 + Math.cos(a1) * R, y1 = 90 + Math.sin(a1) * R;
                            const x2 = 90 + Math.cos(a2) * R, y2 = 90 + Math.sin(a2) * R;
                            const x3 = 90 + Math.cos(a2) * r, y3 = 90 + Math.sin(a2) * r;
                            const x4 = 90 + Math.cos(a1) * r, y4 = 90 + Math.sin(a1) * r;
                            const large = end - start > 0.5 ? 1 : 0;
                            return (
                              <path key={i} d={\`M \${x1} \${y1} A \${R} \${R} 0 \${large} 1 \${x2} \${y2} L \${x3} \${y3} A \${r} \${r} 0 \${large} 0 \${x4} \${y4} Z\`} fill={p.color}/>
                            );
                          });
                        })()}
                      </svg>
                      <div style={{position: "absolute", textAlign: "center"}}>
                        <div className="eyebrow muted" style={{fontSize: 10}}>Total</div>
                        <div style={{fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em"}} className="tnum">\${d.totalCost.toFixed(0)}</div>
                      </div>
                    </div>
                    <div className="flex-col gap-2 mt-4">
                      {providerSplit.map(p => (
                        <div key={p.p} className="flex justify-between items-center" style={{fontSize: 12}}>
                          <span className="flex gap-2 items-center"><span className="chip__dot" style={{background: p.color, width: 8, height: 8}}/><span className="mono">{p.p}</span></span>
                          <span className="tnum" style={{fontWeight: 500}}>\${p.cost.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{fontSize: 13, color: "var(--text-slate)"}}>No provider data</div>
                )}
              </div>
            </section>

            {/* Tasks table */}
            <section id="tasks" className="card" style={{padding: 24, marginBottom: 16}}>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <div className="eyebrow" style={{marginBottom: 6}}>Tasks</div>
                  <h3 className="t-h3" style={{margin: 0}}>Cost by task · {d.period}</h3>
                </div>
              </div>
              {d.tasks.length > 0 ? (
                <table className="t">
                  <thead><tr>
                    <th>task_id</th>
                    <th>model</th>
                    <th style={{textAlign: "right"}}>events</th>
                    <th style={{textAlign: "right"}}>runs</th>
                    <th style={{textAlign: "right"}}>% of total</th>
                    <th style={{textAlign: "right"}}>cost (usd)</th>
                  </tr></thead>
                  <tbody>
                    {d.tasks.map(t => (
                      <tr key={t.id} style={{cursor: "pointer"}} onClick={() => {
                        if (!onNav) return;
                        // "unassigned" is a synthetic bucket for inbox events, not a real task.
                        if (t.id === "unassigned") onNav("inbox");
                        else onNav("task", t.id);
                      }}>
                        <td className="mono" style={{fontSize: 13}}>
                          {t.id}
                          {t.id === "unassigned" && <span className="chip chip--orange" style={{fontSize: 9, marginLeft: 8}}>inbox</span>}
                        </td>
                        <td><span className="chip" style={{fontSize: 11}}>{t.model}</span></td>
                        <td className="tnum" style={{textAlign: "right"}}>{t.events}</td>
                        <td className="tnum" style={{textAlign: "right"}}>{t.runs}</td>
                        <td className="tnum" style={{textAlign: "right", color: "var(--text-slate)"}}>{d.totalCost > 0 ? ((t.cost / d.totalCost) * 100).toFixed(1) : "0.0"}%</td>
                        <td style={{textAlign: "right", fontWeight: 500}} className="tnum">\${t.cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{fontSize: 13, color: "var(--text-slate)", padding: "16px 0"}}>No tasks found</div>
              )}
            </section>

            {/* Inbox */}
            {d.inbox.length > 0 && (
              <section id="inbox" className="card" style={{padding: 24, marginBottom: 16}}>
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <div className="eyebrow" style={{marginBottom: 6}}>Inbox</div>
                    <h4 className="t-h4" style={{margin: 0}}>Unassigned groups</h4>
                  </div>
                  <span className="chip chip--orange">{d.inbox.length} new</span>
                </div>
                <div className="flex-col gap-2">
                  {d.inbox.map(g => (
                    <div key={g.id} style={{padding: 14, border: "1px solid color-mix(in oklab, var(--text-ink) 8%, transparent)", borderRadius: "var(--r-lg)", background: "var(--surface-canvas)"}}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="chip" style={{fontSize: 10, padding: "2px 10px"}}>{g.source}</span>
                        <span className="tnum" style={{fontWeight: 500, fontSize: 14}}>\${g.cost.toFixed(2)}</span>
                      </div>
                      <div className="mono" style={{fontSize: 12, fontWeight: 500, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{g.hint}</div>
                      <div style={{fontSize: 11, color: "var(--text-slate)"}}>{g.events} events · {g.time} · <span className="mono">{g.model}</span></div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Footer */}
            <footer style={{marginTop: 32, padding: "32px 28px", background: "var(--surface-ink)", color: "var(--text-cream)", borderRadius: "var(--r-xl)"}}>
              <div className="flex justify-between items-center" style={{flexWrap: "wrap", gap: 24}}>
                <div>
                  <div className="eyebrow" style={{color: "var(--signal-orange-light)", marginBottom: 8}}>Provenance</div>
                  <div style={{fontSize: 14}}>Generated by <span className="mono">@ttoksem/http dashboard</span> · {d.period} · ttoksem</div>
                  <div style={{fontSize: 12, opacity: 0.6, marginTop: 4}} className="mono">workspace: {d.workspace} · currency: USD</div>
                </div>
              </div>
            </footer>
          </main>
        </div>
      );
    };

    // ═══════════════════════════════════════════════
    // DETAIL COMPONENTS
    // ═══════════════════════════════════════════════

    const DetailHeader = ({ ghost, eyebrow, title, sub, kpis = [], actions, onBack }) => (
      <section style={{position: "relative", padding: "32px 0 24px"}}>
        <div style={{position: "absolute", top: 24, left: -8, fontSize: 144, fontWeight: 500, letterSpacing: "-0.04em", color: "color-mix(in oklab, var(--text-ink) 5%, transparent)", lineHeight: 0.85, pointerEvents: "none", whiteSpace: "nowrap"}}>{ghost}</div>
        <div style={{position: "relative", paddingTop: 80}}>
          <div className="flex justify-between items-end mb-4" style={{flexWrap: "wrap", gap: 16}}>
            <div>
              <div className="flex gap-2 items-center mb-2">
                <button onClick={onBack} className="btn btn--ghost btn--sm" style={{padding: "0 10px", fontSize: 12, color: "var(--text-slate)"}}>← Back to report</button>
              </div>
              <div className="eyebrow" style={{marginBottom: 12}}>{eyebrow}</div>
              <h1 className="mono" style={{fontSize: 36, fontWeight: 500, letterSpacing: "-0.025em", margin: 0, lineHeight: 1.1}}>{title}</h1>
              {sub && <p className="t-small muted" style={{margin: "8px 0 0", maxWidth: 640}}>{sub}</p>}
            </div>
            {actions && <div className="flex gap-2 items-center">{actions}</div>}
          </div>
          {kpis.length > 0 && (
            <div style={{display: "grid", gridTemplateColumns: \`repeat(\${kpis.length}, 1fr)\`, gap: 12, marginTop: 24}}>
              {kpis.map((k, i) => (
                <div key={i} className="kpi" style={{padding: 18}}>
                  <div className="kpi__label">{k.label}</div>
                  <div className="kpi__value tnum" style={{color: k.color || "var(--text-ink)"}}>{k.value}</div>
                  {k.sub && <div className="kpi__sub">{k.sub}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );

    const DetailSidebar = ({ active, onNav, workspace }) => {
      const nav = [
        ["Overview", "pro"],
        ["Tasks", "task"],
        ["Runs", "run"],
        ["Inbox", "inbox"],
        ["Pricing snapshots", "pricing"],
      ];
      return (
        <aside style={{padding: "24px 20px", borderRight: "1px solid color-mix(in oklab, var(--text-ink) 8%, transparent)", background: "var(--surface-lifted)", position: "sticky", top: 0, height: "100vh", overflowY: "auto"}}>
          <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 32}}>
            <PillMark size={28}/>
            <span style={{fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em"}}>ttoksem</span>
          </div>
          <div className="eyebrow muted" style={{marginBottom: 12}}>Workspace</div>
          <button className="chip chip--solid" style={{width: "100%", justifyContent: "space-between", padding: "10px 16px", border: "none", cursor: "default"}}>
            <span className="mono">{workspace || defaultWorkspace}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
          <div className="eyebrow muted" style={{margin: "32px 0 12px"}}>Navigation</div>
          <nav className="flex-col gap-2">
            {nav.map(([l, key]) => (
              <button key={l} onClick={() => onNav(key)} style={{
                textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 12px", borderRadius: "var(--r-md)",
                background: active === key ? "var(--text-ink)" : "transparent",
                color: active === key ? "var(--text-cream)" : "var(--text-ink)",
                border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500, fontFamily: "inherit"
              }}>
                <span>{l}</span>
              </button>
            ))}
          </nav>
        </aside>
      );
    };

    const DetailFooter = ({ source }) => (
      <footer style={{marginTop: 32, padding: "32px 28px", background: "var(--surface-ink)", color: "var(--text-cream)", borderRadius: "var(--r-xl)"}}>
        <div className="flex justify-between items-center" style={{flexWrap: "wrap", gap: 24}}>
          <div>
            <div className="eyebrow" style={{color: "var(--signal-orange-light)", marginBottom: 8}}>Provenance</div>
            <div style={{fontSize: 14}}>Generated by <span className="mono">{source}</span> · ttoksem</div>
          </div>
        </div>
      </footer>
    );

    const DetailShell = ({ activeNav, children, onNav, workspace }) => (
      <div style={{background: "var(--surface-canvas)", display: "grid", gridTemplateColumns: "260px 1fr", minHeight: "100vh"}}>
        <DetailSidebar active={activeNav} onNav={onNav} workspace={workspace}/>
        <main style={{padding: "0 32px 64px"}}>{children}</main>
      </div>
    );

    // Task Detail
    const TaskDetail = ({ taskData, onNav, workspace }) => {
      if (!taskData) return (
        <DetailShell activeNav="task" onNav={onNav} workspace={workspace}>
          <div style={{padding: "64px 0", textAlign: "center", color: "var(--text-slate)"}}>Loading task…</div>
        </DetailShell>
      );

      const t = taskData;
      const trend = t.daily && t.daily.length > 0 ? t.daily : [];
      const maxTrend = Math.max(...trend, 0.01);

      return (
        <DetailShell activeNav="task" onNav={onNav} workspace={workspace}>
          <DetailHeader
            ghost="task"
            eyebrow={\`task · \${t.workspace}\`}
            title={t.id}
            sub={\`Started \${t.started} · \${t.runs} runs · \${t.events.toLocaleString()} events\`}
            onBack={() => onNav("pro")}
            actions={<>
              <span className="chip chip--pos"><span className="chip__dot"/>{t.status}</span>
              <button className="btn btn--secondary btn--sm">Export</button>
            </>}
            kpis={[
              { label: "Total cost", value: \`\$\${t.cost.toFixed(2)}\` },
              { label: "Events", value: t.events.toLocaleString(), sub: \`\${t.runs} runs\` },
              { label: "Tokens", value: t.tokens > 0 ? \`\${(t.tokens / 1_000_000).toFixed(2)}M\` : "—" },
              { label: "Avg / run", value: t.runs > 0 ? \`\$\${(t.cost / t.runs).toFixed(2)}\` : "—", sub: t.runs > 0 ? \`\${Math.round(t.events / t.runs)} events / run\` : "" },
            ]}
          />

          {trend.length > 0 && (
            <section className="card" style={{padding: 24, marginBottom: 16}}>
              <div className="flex justify-between items-end mb-4">
                <div>
                  <div className="eyebrow" style={{marginBottom: 6}}>Cost trend</div>
                  <h4 className="t-h4" style={{margin: 0}}>Daily cost</h4>
                </div>
              </div>
              <div style={{display: "flex", alignItems: "flex-end", gap: 4, height: 140}}>
                {trend.map((v, i) => (
                  <div key={i} style={{flex: 1, height: \`\${(v / maxTrend) * 100}%\`, background: i === trend.length - 1 ? "var(--signal-orange)" : "var(--text-ink)", borderRadius: "var(--r-pill)", minHeight: 4}}/>
                ))}
              </div>
            </section>
          )}

          {t.runs_list && t.runs_list.length > 0 && (
            <section className="card" style={{padding: 24, marginBottom: 16}}>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <div className="eyebrow" style={{marginBottom: 6}}>Runs</div>
                  <h4 className="t-h4" style={{margin: 0}}>{t.runs} runs in this task</h4>
                </div>
              </div>
              <table className="t">
                <thead><tr>
                  <th>run_id</th><th>source</th><th>started</th><th>duration</th><th style={{textAlign: "right"}}>events</th><th style={{textAlign: "right"}}>cost</th><th>status</th>
                </tr></thead>
                <tbody>
                  {t.runs_list.map(r => (
                    <tr key={r.id} style={{cursor: r.rawId ? "pointer" : "default"}} onClick={() => r.rawId && onNav("run", null, r.rawId)}>
                      <td className="mono" style={{fontSize: 12}}>{r.id}</td>
                      <td><span className="chip" style={{fontSize: 10}}>{r.source}</span></td>
                      <td className="mono" style={{fontSize: 11, color: "var(--text-slate)"}}>{r.started}</td>
                      <td className="mono" style={{fontSize: 11}}>{r.duration}</td>
                      <td className="tnum" style={{textAlign: "right"}}>{r.events}</td>
                      <td className="tnum" style={{textAlign: "right", fontWeight: 500}}>\${r.cost.toFixed(2)}</td>
                      <td><span className="chip chip--pos" style={{fontSize: 10}}><span className="chip__dot"/>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {t.recent && t.recent.length > 0 && (
            <section className="card" style={{padding: 24, marginBottom: 16}}>
              <div className="eyebrow" style={{marginBottom: 6}}>Prompt samples</div>
              <h4 className="t-h4" style={{margin: 0, marginBottom: 16}}>Recent snapshots</h4>
              <div className="flex-col gap-3">
                {t.recent.map(p => (
                  <div key={p.id} style={{padding: 14, borderLeft: \`3px solid \${p.role === "user" ? "var(--signal-orange)" : "var(--text-ink)"}\`, background: "var(--surface-canvas)", borderRadius: "0 var(--r-lg) var(--r-lg) 0"}}>
                    <div className="flex justify-between items-center mb-2" style={{fontSize: 11}}>
                      <span className="flex gap-2 items-center">
                        <span className="chip" style={{fontSize: 10, padding: "2px 8px"}}>{p.role}</span>
                        <span className="mono muted">{p.model}</span>
                      </span>
                      <span className="tnum muted">{p.time} · {p.tokens} tok</span>
                    </div>
                    <div style={{fontSize: 13, lineHeight: 1.5, color: "var(--text-ink)"}}>{p.text}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <DetailFooter source={\`@ttoksem/cli report task \${t.id}\`}/>
        </DetailShell>
      );
    };

    // Run Detail — real data from taskData.rawRuns + rawEvents filtered by runId
    const RunDetail = ({ onNav, workspace, runId, taskData }) => {
      const run = taskData?.rawRuns?.find(r => r.run_id === runId) || null;
      const events = (taskData?.rawEvents || []).filter(e => e.run_id === runId);
      let acc = 0;
      const cumulative = events.map(e => { acc += (e.cost || 0); return acc; });
      const totalCost = run?.estimated_total || events.reduce((a, e) => a + (e.cost || 0), 0);
      const totalTokens = run?.token_count || events.reduce((a, e) => a + (e.tokens || 0), 0);
      const fmt = s => s ? s.slice(0, 16).replace("T", " ") : "—";
      const dur = run?.span_duration_ms ? \`\${Math.round(run.span_duration_ms / 1000)}s\` : (run?.event_duration_ms ? \`\${Math.round(run.event_duration_ms / 1000)}s\` : "—");
      return (
        <DetailShell activeNav="run" onNav={onNav} workspace={workspace}>
          <DetailHeader
            ghost="run trace"
            eyebrow={\`run · \${run?.source || "unknown"}\`}
            title={runId ? runId.slice(0, 24) + (runId.length > 24 ? "…" : "") : "run trace"}
            sub={run ? \`\${fmt(run.started_at)} → \${fmt(run.ended_at)} · \${run.event_count} events · \${dur}\` : "Select a run from the task view"}
            onBack={() => onNav("task")}
            actions={<>
              {run?.status && <span className={\`chip \${run.status === "closed" ? "chip--pos" : "chip--orange"}\`}><span className="chip__dot"/>{run.status}</span>}
            </>}
            kpis={run ? [
              { label: "Cost", value: \`$\${totalCost.toFixed(4)}\` },
              { label: "Events", value: run.event_count },
              { label: "Tokens", value: totalTokens >= 1000 ? \`\${(totalTokens/1000).toFixed(0)}k\` : totalTokens },
              { label: "Duration", value: dur },
            ] : []}
          />
          {events.length > 0 && (
            <>
              <section className="card" style={{padding: 28, marginBottom: 16}}>
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <div className="eyebrow" style={{marginBottom: 6}}>Cost trace</div>
                    <h4 className="t-h4" style={{margin: 0}}>Cumulative cost · {events.length} events</h4>
                  </div>
                  <span className="chip"><span className="chip__dot" style={{background: "var(--signal-orange)"}}/>cumulative \${totalCost.toFixed(4)}</span>
                </div>
                <div style={{position: "relative", height: 160}}>
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{position: "absolute", inset: 0}}>
                    <path d={\`M 0 100 \${cumulative.map((c, i) => \`L \${(i / Math.max(cumulative.length - 1, 1)) * 100} \${100 - (totalCost > 0 ? (c / totalCost) * 95 : 0)}\`).join(" ")} L 100 100 Z\`} fill="color-mix(in oklab, var(--signal-orange) 12%, transparent)"/>
                    <path d={\`M 0 100 \${cumulative.map((c, i) => \`L \${(i / Math.max(cumulative.length - 1, 1)) * 100} \${100 - (totalCost > 0 ? (c / totalCost) * 95 : 0)}\`).join(" ")}\`} stroke="var(--signal-orange)" strokeWidth="0.6" fill="none" vectorEffect="non-scaling-stroke"/>
                  </svg>
                </div>
              </section>
              <section className="card" style={{padding: 24, marginBottom: 16}}>
                <div className="eyebrow" style={{marginBottom: 6}}>Events</div>
                <h4 className="t-h4" style={{margin: 0, marginBottom: 16}}>Timeline · {events.length} events</h4>
                <table className="t">
                  <thead><tr>
                    <th>occurred_at</th><th>provider/model</th><th>kind</th><th>mode</th><th style={{textAlign:"right"}}>tokens</th><th style={{textAlign:"right"}}>cost</th><th style={{textAlign:"right"}}>cumulative</th>
                  </tr></thead>
                  <tbody>
                    {events.map((e, i) => (
                      <tr key={e.id}>
                        <td className="mono" style={{fontSize: 11, color: "var(--text-slate)"}}>{e.occurred_at.slice(11, 19)}</td>
                        <td className="mono" style={{fontSize: 11}}>{e.provider_model}</td>
                        <td><span className="chip" style={{fontSize: 10}}>{e.usage_kind}</span></td>
                        <td className="mono" style={{fontSize: 10, color: "var(--text-slate)"}}>{e.confidence}</td>
                        <td className="tnum" style={{textAlign:"right", fontSize:12}}>{e.tokens ? e.tokens.toLocaleString() : "—"}</td>
                        <td className="tnum" style={{textAlign:"right", fontSize:12, fontWeight:500}}>{e.cost ? \`$\${e.cost.toFixed(4)}\` : "—"}</td>
                        <td className="tnum" style={{textAlign:"right", fontSize:12, color:"var(--text-slate)"}}>\${cumulative[i].toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
          {events.length === 0 && (
            <div style={{padding: "48px 0", textAlign: "center", color: "var(--text-slate)", fontSize: 14}}>
              {runId ? "No events found for this run." : "Navigate to a task and click a run row to view its trace."}
            </div>
          )}
          <DetailFooter source={\`@ttoksem/cli usage events --run \${runId || ""}\`}/>
        </DetailShell>
      );
    };

    // Inbox Detail — real data from GET /api/inbox/groups
    const InboxDetail = ({ onNav, workspace, inboxData }) => {
      const groups = inboxData || [];
      const totalEvents = groups.reduce((a, g) => a + g.event_count, 0);
      const totalCost = groups.reduce((a, g) => a + (g.estimated_total || 0), 0);
      return (
        <DetailShell activeNav="inbox" onNav={onNav} workspace={workspace}>
          <DetailHeader
            ghost="inbox"
            eyebrow={\`inbox · \${workspace}\`}
            title="unassigned groups"
            sub={\`\${groups.length} group\${groups.length !== 1 ? "s" : ""} · \${totalEvents} events waiting for task classification\`}
            onBack={() => onNav("pro")}
            kpis={groups.length > 0 ? [
              { label: "Groups", value: groups.length },
              { label: "Events", value: totalEvents },
              { label: "Est. cost", value: \`$\${totalCost.toFixed(4)}\` },
            ] : []}
          />
          {groups.length === 0 ? (
            <div style={{padding: "48px 0", textAlign: "center", color: "var(--text-slate)", fontSize: 14}}>
              Inbox is empty — all events are assigned to tasks.
            </div>
          ) : (
            <section className="card" style={{padding: 24, marginBottom: 16}}>
              <div className="eyebrow" style={{marginBottom: 6}}>Groups</div>
              <h4 className="t-h4" style={{margin: 0, marginBottom: 16}}>Unassigned inbox groups</h4>
              <div className="flex-col gap-3">
                {groups.map(g => (
                  <div key={g.group_id} style={{padding: 16, border: "1px solid color-mix(in oklab, var(--text-ink) 8%, transparent)", borderRadius: "var(--r-lg)", background: "var(--surface-canvas)"}}>
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex gap-2 items-center">
                        <span className="chip chip--orange" style={{fontSize: 10}}><span className="chip__dot"/>{g.assignment_status}</span>
                        <span className="mono" style={{fontSize: 12, fontWeight: 500}}>{g.group_id}</span>
                      </div>
                      <span className="tnum" style={{fontWeight: 500, fontSize: 14}}>\${(g.estimated_total || 0).toFixed(4)}</span>
                    </div>
                    {g.suggested_task && (
                      <div style={{marginBottom: 10, padding: "8px 12px", background: "color-mix(in oklab, var(--pos) 8%, transparent)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", justifyContent: "space-between"}}>
                        <span style={{fontSize: 12}}>Suggested: <span className="mono" style={{fontWeight: 500}}>{g.suggested_task.task_key}</span></span>
                        <span className="chip chip--pos" style={{fontSize: 10}}>{Math.round(g.suggested_task.confidence * 100)}% match</span>
                      </div>
                    )}
                    {g.prompt_samples?.length > 0 && (
                      <div style={{padding: "8px 12px", background: "var(--surface-lifted)", borderRadius: "var(--r-sm)", borderLeft: "3px solid var(--signal-orange)", marginBottom: 8}}>
                        <div style={{fontSize: 12, color: "var(--text-slate)", marginBottom: 2}}>Prompt sample</div>
                        <div style={{fontSize: 13, lineHeight: 1.4}}>{g.prompt_samples[0].slice(0, 160)}{g.prompt_samples[0].length > 160 ? "…" : ""}</div>
                      </div>
                    )}
                    <div className="flex gap-3 items-center" style={{fontSize: 11, color: "var(--text-slate)"}}>
                      <span>{g.event_count} events</span>
                      <span>·</span>
                      <span className="mono">{g.source_context?.tool || "unknown"}</span>
                      <span>·</span>
                      <span>{g.first_occurred_at.slice(0, 10)}</span>
                      {g.source_context?.git_branch && <><span>·</span><span className="mono">{g.source_context.git_branch}</span></>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <DetailFooter source="@ttoksem/cli inbox list"/>
        </DetailShell>
      );
    };

    // Pricing Detail — real data from GET /api/pricing/snapshots + /api/pricing/rules
    const PricingDetail = ({ onNav, workspace, pricingData }) => {
      const snapshots = pricingData?.snapshots || [];
      const rules = pricingData?.rules || [];
      const activeSnaps = snapshots.filter(s => !s.valid_from || s.valid_from <= new Date().toISOString());
      const providers = [...new Set(rules.map(r => r.provider))];
      return (
        <DetailShell activeNav="pricing" onNav={onNav} workspace={workspace}>
          <DetailHeader
            ghost="pricing"
            eyebrow={\`pricing · \${workspace}\`}
            title="pricing catalog"
            sub={\`\${snapshots.length} snapshot\${snapshots.length !== 1 ? "s" : ""} · \${rules.length} rules · \${providers.length} providers\`}
            onBack={() => onNav("pro")}
            kpis={[
              { label: "Snapshots", value: snapshots.length },
              { label: "Rules", value: rules.length },
              { label: "Providers", value: providers.length },
            ]}
          />
          {snapshots.length > 0 && (
            <section className="card" style={{padding: 24, marginBottom: 16}}>
              <div className="eyebrow" style={{marginBottom: 6}}>Snapshots</div>
              <h4 className="t-h4" style={{margin: 0, marginBottom: 16}}>Pricing source catalogs</h4>
              <div className="flex-col gap-2">
                {snapshots.map(s => (
                  <div key={s.id} style={{display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "center", padding: "12px 16px", borderRadius: "var(--r-lg)", border: "1px solid color-mix(in oklab, var(--text-ink) 8%, transparent)", background: "var(--surface-canvas)"}}>
                    <span className="chip chip--pos" style={{fontSize: 10}}><span className="chip__dot"/>active</span>
                    <div>
                      <div className="mono" style={{fontSize: 12, fontWeight: 500}}>{s.id}</div>
                      <div style={{fontSize: 11, color: "var(--text-slate)", marginTop: 2}}>
                        source: {s.source_name}
                        {s.source_version ? \` · v\${s.source_version}\` : ""}
                        {s.valid_from ? \` · valid from \${s.valid_from.slice(0, 10)}\` : ""}
                      </div>
                    </div>
                    <span className="mono" style={{fontSize: 10, color: "var(--text-slate)"}}>{s.raw_sha256.slice(0, 12)}…</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {rules.length > 0 && (
            <section className="card" style={{padding: 24, marginBottom: 16}}>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <div className="eyebrow" style={{marginBottom: 6}}>Rules</div>
                  <h4 className="t-h4" style={{margin: 0}}>Active pricing rules · {rules.length}</h4>
                </div>
                <div className="flex gap-2">
                  {providers.map(p => <span key={p} className="chip" style={{fontSize: 11}}>{p}</span>)}
                </div>
              </div>
              <table className="t">
                <thead><tr>
                  <th>provider</th><th>model</th><th>usage_kind</th><th>unit_type</th>
                  <th style={{textAlign:"right"}}>price / unit</th><th>currency</th><th>effective_from</th>
                </tr></thead>
                <tbody>
                  {rules.slice(0, 40).map(r => (
                    <tr key={r.id}>
                      <td className="mono" style={{fontSize: 11}}>{r.provider}</td>
                      <td className="mono" style={{fontSize: 11}}>{r.model}</td>
                      <td><span className="chip" style={{fontSize: 10}}>{r.usage_kind}</span></td>
                      <td className="mono" style={{fontSize: 11, color: "var(--text-slate)"}}>{r.unit_type}</td>
                      <td className="tnum" style={{textAlign:"right", fontSize:12, fontWeight:500}}>{(r.price_nanos_per_unit / 1e9).toFixed(9)}</td>
                      <td style={{fontSize: 11}}>{r.currency}</td>
                      <td className="mono" style={{fontSize: 11, color: "var(--text-slate)"}}>{r.effective_from.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rules.length > 40 && <div style={{marginTop: 12, fontSize: 12, color: "var(--text-slate)", textAlign: "center"}}>Showing 40 of {rules.length} rules</div>}
            </section>
          )}
          {snapshots.length === 0 && rules.length === 0 && (
            <div style={{padding: "48px 0", textAlign: "center", color: "var(--text-slate)", fontSize: 14}}>
              No pricing snapshots yet. Import one with <code style={{fontFamily: "var(--font-mono)", fontSize: 12}}>pnpm cli pricing import-litellm</code>
            </div>
          )}
          <DetailFooter source="@ttoksem/cli pricing snapshot list"/>
        </DetailShell>
      );
    };

    // ═══════════════════════════════════════════════
    // APP ROOT
    // ═══════════════════════════════════════════════

    function App() {
      const [theme, setTheme] = React.useState("light");
      const [view, setView] = React.useState(initialTaskKey ? "task" : "pro");
      const [activeTaskKey, setActiveTaskKey] = React.useState(initialTaskKey);
      const [activeRunId, setActiveRunId] = React.useState(null);

      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState(null);
      const [dashData, setDashData] = React.useState(null);
      const [taskData, setTaskData] = React.useState(null);
      const [taskLoading, setTaskLoading] = React.useState(false);
      const [taskError, setTaskError] = React.useState(null);
      const [inboxData, setInboxData] = React.useState(null);
      const [pricingData, setPricingData] = React.useState(null);

      React.useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
      }, [theme]);

      async function fetchDashboard(workspaceKey) {
        setLoading(true);
        setError(null);
        try {
          const res = await fetch(\`/api/dashboard?workspace=\${encodeURIComponent(workspaceKey)}\`, {
            headers: authHeaders(),
          });
          if (!res.ok) throw new Error(\`HTTP \${res.status}: \${res.statusText}\`);
          const api = await res.json();
          setDashData(mapDashboard(api, workspaceKey));
        } catch (e) {
          setError(e.message || "Failed to load dashboard");
        } finally {
          setLoading(false);
        }
      }

      async function fetchTask(workspaceKey, taskKey) {
        setTaskLoading(true);
        setTaskError(null);
        try {
          const res = await fetch(\`/api/tasks/\${encodeURIComponent(taskKey)}?workspace=\${encodeURIComponent(workspaceKey)}\`, {
            headers: authHeaders(),
          });
          if (res.status === 404) {
            setTaskError(\`Task "\${taskKey}" not found.\`);
            return;
          }
          if (!res.ok) throw new Error(\`HTTP \${res.status}: \${res.statusText}\`);
          const api = await res.json();
          setTaskData(mapTaskDetail(api, dashData));
        } catch (e) {
          console.error("Task load error:", e);
          setTaskError(e.message || "Failed to load task.");
        } finally {
          setTaskLoading(false);
        }
      }

      async function fetchInbox(workspaceKey) {
        try {
          const res = await fetch(\`/api/inbox/groups?workspace=\${encodeURIComponent(workspaceKey)}\`, {
            headers: authHeaders(),
          });
          if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
          const json = await res.json();
          setInboxData(json.groups || []);
        } catch (e) {
          console.error("Inbox load error:", e);
          setInboxData([]);
        }
      }

      async function fetchPricing(workspaceKey) {
        try {
          const [snapRes, rulesRes] = await Promise.all([
            fetch(\`/api/pricing/snapshots?workspace=\${encodeURIComponent(workspaceKey)}\`, { headers: authHeaders() }),
            fetch(\`/api/pricing/rules?workspace=\${encodeURIComponent(workspaceKey)}\`, { headers: authHeaders() }),
          ]);
          const [snapJson, rulesJson] = await Promise.all([snapRes.json(), rulesRes.json()]);
          setPricingData({ snapshots: snapJson.snapshots || [], rules: rulesJson.rules || [] });
        } catch (e) {
          console.error("Pricing load error:", e);
          setPricingData({ snapshots: [], rules: [] });
        }
      }

      React.useEffect(() => {
        fetchDashboard(defaultWorkspace);
      }, []);

      React.useEffect(() => {
        if (initialTaskKey) {
          fetchTask(defaultWorkspace, initialTaskKey);
        }
      }, []);

      function handleNav(newView, taskKey, runIdParam) {
        if (newView === "task" && taskKey) {
          setActiveTaskKey(taskKey);
          setTaskData(null);
          fetchTask(defaultWorkspace, taskKey);
        }
        if (newView === "run" && runIdParam) {
          setActiveRunId(runIdParam);
        }
        if (newView === "inbox" && !inboxData) {
          fetchInbox(defaultWorkspace);
        }
        if (newView === "pricing" && !pricingData) {
          fetchPricing(defaultWorkspace);
        }
        setView(newView);
      }

      if (loading) {
        return (
          <div id="loading-screen">
            <div className="spinner"></div>
            <div style={{fontSize: 14, color: "var(--text-slate)", fontFamily: "var(--font-sans)"}}>Loading dashboard…</div>
          </div>
        );
      }

      if (error) {
        return (
          <div id="error-screen">
            <PillMark size={40}/>
            <div style={{fontSize: 18, fontWeight: 500, color: "var(--text-ink)", fontFamily: "var(--font-sans)"}}>Failed to load</div>
            <div style={{fontSize: 14, color: "var(--text-slate)", fontFamily: "var(--font-sans)", maxWidth: 400, textAlign: "center"}}>{error}</div>
            <button className="btn btn--primary btn--sm" onClick={() => fetchDashboard(defaultWorkspace)}>Retry</button>
          </div>
        );
      }

      const themeBtn = (
        <button
          className="btn btn--secondary btn--sm"
          style={{position: "fixed", top: 16, right: 16, zIndex: 100}}
          onClick={() => setTheme(t => t === "light" ? "dark" : "light")}
        >
          {theme === "light" ? "Dark" : "Light"}
        </button>
      );

      if (view === "task") {
        if (taskError) {
          return <>
            {themeBtn}
            <div style={{maxWidth: 600, margin: "120px auto", padding: 32, background: "var(--surface-lifted)", border: "1px solid color-mix(in oklab, var(--text-ink) 8%, transparent)", borderRadius: "var(--r-xl)", textAlign: "center"}}>
              <div className="eyebrow" style={{justifyContent: "center", marginBottom: 12}}>error</div>
              <div style={{fontSize: 18, fontWeight: 500, marginBottom: 8}}>Task unavailable</div>
              <div style={{fontSize: 14, color: "var(--text-slate)", marginBottom: 24}}>{taskError}</div>
              <button className="btn btn--primary btn--sm" onClick={() => handleNav("pro")}>Back to dashboard</button>
            </div>
          </>;
        }
        const td = taskLoading ? null : taskData;
        return <>
          {themeBtn}
          <TaskDetail taskData={td} onNav={handleNav} workspace={defaultWorkspace}/>
        </>;
      }
      if (view === "run") {
        return <>
          {themeBtn}
          <RunDetail onNav={handleNav} workspace={defaultWorkspace} runId={activeRunId} taskData={taskData}/>
        </>;
      }
      if (view === "inbox") {
        return <>
          {themeBtn}
          <InboxDetail onNav={handleNav} workspace={defaultWorkspace} inboxData={inboxData}/>
        </>;
      }
      if (view === "pricing") {
        return <>
          {themeBtn}
          <PricingDetail onNav={handleNav} workspace={defaultWorkspace} pricingData={pricingData}/>
        </>;
      }

      return <>
        {themeBtn}
        <CompactPro data={dashData} onNav={handleNav}/>
      </>;
    }

    ReactDOM.createRoot(document.getElementById("app")).render(<App/>);
  </script>
</body>
</html>`;
}

export function renderLoginHtml(workspace: string, errorMsg?: string): string {
  const workspaceJson = JSON.stringify(workspace);
  const err = errorMsg ? `<div class="err">${errorMsg}</div>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ttoksem · Sign in</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
@import url('https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;500;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --canvas:#F3F0EE;--ink:#141413;--cream:#FAF8F6;--orange:#CF4500;
  --slate:#6B6560;--border:color-mix(in oklab,#141413 12%,transparent);
  --font:'Sofia Sans',system-ui,sans-serif;
}
body{background:var(--canvas);color:var(--ink);font-family:var(--font);min-height:100dvh;display:grid;place-items:center;}
.shell{width:min(380px,90vw);}
.brand{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:500;letter-spacing:-0.02em;margin-bottom:40px;}
.mark{width:32px;height:32px;background:var(--ink);border-radius:50%;display:grid;place-items:center;}
.mark svg{display:block;}
.card{background:#fff;border-radius:20px;padding:32px;box-shadow:0 2px 12px color-mix(in oklab,var(--ink) 8%,transparent);}
h1{font-size:20px;font-weight:700;letter-spacing:-0.02em;margin-bottom:6px;}
.sub{font-size:14px;color:var(--slate);margin-bottom:24px;}
label{display:block;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--slate);margin-bottom:8px;}
input{width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-family:var(--font);font-size:15px;background:var(--canvas);color:var(--ink);outline:none;transition:border-color 120ms;}
input:focus{border-color:var(--ink);}
button{width:100%;margin-top:16px;padding:11px;background:var(--ink);color:var(--cream);border:none;border-radius:10px;font-family:var(--font);font-size:15px;font-weight:500;letter-spacing:-0.01em;cursor:pointer;transition:opacity 120ms;}
button:active{opacity:0.85;}
.err{margin-top:14px;padding:10px 14px;background:color-mix(in oklab,#c0392b 10%,transparent);color:#c0392b;border-radius:8px;font-size:13px;font-weight:500;}
.ws{margin-top:18px;font-size:12px;color:var(--slate);text-align:center;}
.ws code{font-family:monospace;background:var(--canvas);padding:1px 6px;border-radius:4px;}
  </style>
</head>
<body>
  <div class="shell">
    <div class="brand">
      <div class="mark">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="4" fill="#FAF8F6"/>
          <path d="M9 2v3M9 13v3M2 9h3M13 9h3" stroke="#FAF8F6" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      ttoksem
    </div>
    <div class="card">
      <h1>Sign in</h1>
      <div class="sub">Enter your workspace access key to continue.</div>
      <form method="post" action="/login">
        <label for="key">Access key</label>
        <input id="key" name="key" type="password" autocomplete="current-password" placeholder="••••••••" autofocus required/>
        <button type="submit">Continue →</button>
        ${err}
      </form>
    </div>
    <div class="ws">workspace: <code id="ws"></code></div>
  </div>
  <script>document.getElementById("ws").textContent=${workspaceJson};</script>
</body>
</html>`;
}
