* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --ink: #111111;
  --muted: #8a8a8a;
  --line: #e6e2da;
  --bg: #fdfcfa;
  --card: #ffffff;
  --accent: #111111;
  --ok: #1a7f37;
  --warn: #b58900;
  --err: #c20000;
  --amber-bg: #fdf3e0;
  --amber-ink: #9a6700;
}

html,
body {
  background: var(--bg);
  color: var(--ink);
  font-family: Georgia, "Times New Roman", Times, serif;
  font-size: 15px;
  line-height: 1.45;
}

a {
  color: inherit;
  text-decoration: none;
}

/* ---------- Header ---------- */
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--line);
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 50;
}
.topbar .logo {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--ink);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}
.topbar .title {
  font-weight: 700;
  font-size: 16px;
}
.topbar .subtitle {
  color: var(--muted);
  font-size: 13px;
  border-left: 1px solid var(--line);
  padding-left: 12px;
}
.topbar .spacer {
  flex: 1;
}
.topbar .navlink {
  font-size: 13px;
  color: var(--ink);
  padding: 4px 10px;
}
.topbar .navlink + .navlink {
  border-left: 1px solid var(--line);
}
.topbar .logout {
  font-size: 12px;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  font-family: inherit;
}
.topbar .logout:hover {
  color: var(--ink);
}

/* ---------- Layout ---------- */
.page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px;
  display: grid;
  gap: 20px;
}
.layout-2col {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 20px;
  align-items: start;
}
.layout-scraper {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 20px;
  align-items: start;
}
@media (max-width: 900px) {
  .layout-2col,
  .layout-scraper {
    grid-template-columns: 1fr;
  }
}

/* ---------- Cards ---------- */
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
}
.card + .card {
  margin-top: 16px;
}
.card h2 {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.card h2 .opt {
  color: var(--muted);
  font-weight: 400;
  font-size: 13px;
}
.hint {
  color: var(--muted);
  font-size: 12.5px;
  margin-top: 6px;
}
.field-label {
  font-weight: 700;
  font-size: 14px;
  margin: 14px 0 6px;
  display: flex;
  gap: 6px;
  align-items: baseline;
}
.field-label .opt {
  color: var(--muted);
  font-weight: 400;
  font-size: 12.5px;
}

/* ---------- Inputs ---------- */
input[type="text"],
input[type="password"],
input[type="number"],
input[type="email"],
textarea,
select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 14px;
  background: #fff;
  color: var(--ink);
}
textarea {
  min-height: 90px;
  resize: vertical;
}
input::placeholder,
textarea::placeholder {
  color: #b9b4ab;
}
input:focus,
textarea:focus {
  outline: none;
  border-color: #b9b4ab;
}

/* ---------- Buttons ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--ink);
  background: var(--ink);
  color: #fff;
  border-radius: 999px;
  padding: 9px 16px;
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  width: 100%;
}
.btn:disabled {
  background: #d9d5cd;
  border-color: #d9d5cd;
  color: #fff;
  cursor: not-allowed;
}
.btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: inherit;
  font-size: 13.5px;
  cursor: pointer;
  width: 100%;
}
.btn-ghost:hover {
  border-color: #b9b4ab;
}
.btn-ghost:disabled {
  color: #b9b4ab;
  cursor: not-allowed;
}
.btn-small {
  width: auto;
  padding: 5px 12px;
  font-size: 12.5px;
  border-radius: 8px;
}

/* ---------- Segmented controls ---------- */
.seg {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
.seg button {
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  border-radius: 8px;
  padding: 6px 12px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}
.seg button.on {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}

/* ---------- Toggles ---------- */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  font-size: 14px;
}
.switch {
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: #ddd8cf;
  border: none;
  position: relative;
  cursor: pointer;
  flex: none;
}
.switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
}
.switch.on {
  background: var(--ink);
}
.switch.on::after {
  left: 16px;
}

/* ---------- Badges & logs ---------- */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  border-radius: 999px;
  padding: 3px 10px;
}
.badge-amber {
  background: var(--amber-bg);
  color: var(--amber-ink);
  border: 1px solid #f0dcb4;
}
.badge-green {
  background: #e8f5ec;
  color: var(--ok);
  border: 1px solid #c4e2cd;
}
.log {
  font-size: 13px;
  border-top: 1px solid var(--line);
  padding: 7px 2px;
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.log:first-child {
  border-top: none;
}
.log .ok {
  color: var(--ok);
}
.log .err {
  color: var(--err);
}
.log .warn {
  color: var(--warn);
}
.log .muted {
  color: var(--muted);
}
.small {
  font-size: 12.5px;
}
.muted {
  color: var(--muted);
}
.center-note {
  color: var(--muted);
  text-align: center;
  padding: 40px 0;
  font-size: 14px;
}

/* ---------- Store list ---------- */
.store-item {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
  margin-top: 8px;
  cursor: pointer;
  font-size: 13.5px;
}
.store-item.selected {
  border-color: var(--ink);
  box-shadow: 0 0 0 1px var(--ink) inset;
}
.store-item .dom {
  color: var(--muted);
  font-size: 12px;
  word-break: break-all;
}
.store-item .row-actions {
  margin-top: 6px;
  display: flex;
  gap: 10px;
}
.linklike {
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  text-decoration: underline;
}
.linklike:hover {
  color: var(--ink);
}

/* ---------- Keyword rows ---------- */
.kw-row {
  display: grid;
  grid-template-columns: 1fr 64px 24px;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
.kw-x {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 15px;
  font-family: inherit;
}
.kw-x:hover {
  color: var(--err);
}
.group-label {
  font-size: 13px;
  color: var(--muted);
  margin-top: 12px;
}
.add-kw {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  color: var(--ink);
  margin-top: 8px;
  padding: 0;
}
.add-kw:hover {
  text-decoration: underline;
}

/* ---------- Checklist ---------- */
.check-item {
  display: flex;
  gap: 10px;
  border-top: 1px solid var(--line);
  padding: 9px 2px;
  font-size: 13.5px;
  align-items: baseline;
}
.check-item:first-child {
  border-top: none;
}
.check-icon {
  flex: none;
  width: 18px;
  text-align: center;
}
.progressbar {
  height: 6px;
  border-radius: 999px;
  background: #eee9e0;
  overflow: hidden;
  margin: 10px 0;
}
.progressbar > div {
  height: 100%;
  background: var(--ink);
  transition: width 0.2s;
}

/* ---------- Login ---------- */
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
.login-card {
  width: 360px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 28px;
}
.login-card h1 {
  font-size: 18px;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.login-card .sub {
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 18px;
}
.login-card label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  margin: 12px 0 5px;
}
.login-err {
  color: var(--err);
  font-size: 13px;
  margin-top: 10px;
}

/* ---------- Tables ---------- */
.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.mini-table td {
  border-top: 1px solid var(--line);
  padding: 6px 4px;
  vertical-align: top;
}
