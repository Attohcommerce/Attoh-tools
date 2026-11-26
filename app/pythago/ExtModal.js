"use client";

// PYTHAGO EXTERN — beheer (alleen voor Justin, in zijn eigen Pythago).
// Externe mensen (bijv. Cas) krijgen een eigen link /px/<token>; inloggen met
// die link + hun e-mailadres, geen wachtwoord. Ze zien alleen Pythago en alleen
// de stores die hier aan staan. De koppeling van die stores gaat bij opslaan
// vanuit deze browser naar de server, zodat zij niets hoeven te koppelen.
// Onderaan per persoon: alles wat hij/zij deed (logboek).
import { useEffect, useState } from "react";

const cd = (d) => String(d || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
const ago = (iso) => {
  if (!iso) return "nog nooit";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "zojuist";
  if (m < 60) return `${m} min geleden`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} uur geleden`;
  return `${Math.round(h / 24)} dagen geleden`;
};
const when = (iso) => (iso ? new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const ACT = { login: "Ingelogd", sync: "Sync", status: "Status", note: "Notitie", preset: "Filter" };
const EMPTY = { name: "", email: "", stores: [], canEdit: true };

export default function ExtModal({ stores, sel, cfgFor, onClose }) {
  const [users, setUsers] = useState(null);
  const [logs, setLogs] = useState({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, stores: sel ? [cd(sel)] : [] });
  const [editId, setEditId] = useState("");
  const [copied, setCopied] = useState("");
  const [openLog, setOpenLog] = useState("");
  const [known, setKnown] = useState([]);

  // stores uit deze browser + stores die de server kent (ook vanaf je telefoon te kiezen)
  const all = [...stores, ...known.filter((k) => !stores.some((s) => cd(s.domain) === cd(k.domain)))];
  const nameOf = (d) => {
    const s = all.find((x) => cd(x.domain) === cd(d));
    return s ? s.name || s.domain : d;
  };

  async function call(body) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pythago", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ext", ...body }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setUsers(d.users || []);
      setLogs(d.logs || {});
      if (Array.isArray(d.known)) setKnown(d.known);
      return d;
    } catch (e) {
      setError(String(e.message || e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    call({ op: "list" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // koppeling per gekozen store uit deze browser meesturen
  function conns(list) {
    const out = {};
    for (const d of list) {
      const s = stores.find((x) => cd(x.domain) === cd(d));
      const c = s ? cfgFor(s.domain) : null;
      if (c) out[cd(d)] = c;
    }
    return out;
  }
  async function save(u) {
    setMsg("");
    const d = await call({ op: "save", user: u, conns: conns(u.stores || []) });
    if (!d) return false;
    if (d.missing && d.missing.length) setMsg(`Koppeling voor ${d.missing.map(nameOf).join(", ")} komt van de server (Claude-koppeling + instellingen van je laatste sync). Sync die store één keer zelf in Pythago op je pc, dan staat alles 1-op-1 gelijk.`);
    if (!(d.missing && d.missing.length)) setMsg(u.id ? `${d.user.name} bijgewerkt — de koppeling staat klaar.` : `${d.user.name} toegevoegd — kopieer de link hieronder en stuur hem door.`);
    return true;
  }
  async function submit() {
    const ok = await save({ ...form, id: editId || undefined });
    if (ok) {
      setForm({ ...EMPTY, stores: sel ? [cd(sel)] : [] });
      setEditId("");
    }
  }
  function startEdit(u) {
    setEditId(u.id);
    setForm({ name: u.name, email: u.email, stores: [...(u.stores || [])], canEdit: u.canEdit !== false });
    setMsg("");
  }
  async function copy(u) {
    const link = `${window.location.origin}/px/${u.token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(u.id);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      window.prompt("Kopieer de link:", link);
    }
  }
  const toggleStore = (d) => setForm((f) => ({ ...f, stores: f.stores.includes(d) ? f.stores.filter((x) => x !== d) : [...f.stores, d] }));
  const userLog = (u) =>
    (u.stores || [])
      .flatMap((d) => (logs[d] || []).map((e) => ({ ...e, d })))
      .filter((e) => e.email === u.email)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 60);

  return (
    <div className="pyd-modal" onClick={() => !busy && onClose()}>
      <div className="pyd-box md pyx-admin" onClick={(e) => e.stopPropagation()}>
        <div className="pyd-box__head">
          <div>
            <h3>Pythago Extern</h3>
            <div className="sub">Externe mensen loggen in met hun eigen link + e-mailadres (geen wachtwoord) en zien alleen Pythago voor de stores die je aanzet. Hun opgeslagen filters staan bij jou met "van &lt;naam&gt;"; alles wat ze doen zie je hier.</div>
          </div>
          <button className="x" onClick={onClose}>×</button>
        </div>

        {error && <div className="pyd-err" style={{ marginBottom: 10 }}>{error}</div>}
        {msg && !error && <div className="pyd-ok" style={{ marginBottom: 10 }}>{msg}</div>}

        {users === null && <div className="pyd-empty">Laden…</div>}
        {users && !users.length && <div className="pyd-empty">Nog niemand gedeeld.</div>}
        {users && users.length > 0 && (
          <div className="pyd-list">
            {users.map((u) => {
              const log = userLog(u);
              return (
                <div className="pyx-user-row" key={u.id}>
                  <div className="pyx-user-main">
                    <div className="grow">
                      <b>{u.name}</b> <span className="pyx-dim">{u.email}</span>
                      <div className="pyx-dim" style={{ marginTop: 3 }}>
                        {(u.stores || []).map(nameOf).join(", ")} · {u.canEdit !== false ? "mag status wijzigen" : "alleen kijken"} · laatst actief {ago(u.lastSeen)}
                        {u.disabled ? " · toegang uit" : ""}
                      </div>
                    </div>
                    <button className="pyd-ibtn on" onClick={() => copy(u)}>{copied === u.id ? "✓ Gekopieerd" : "🔗 Kopieer link"}</button>
                    <button className="pyd-ibtn" onClick={() => setOpenLog(openLog === u.id ? "" : u.id)}>Activiteit ({log.length})</button>
                    <button className="pyd-ibtn" onClick={() => startEdit(u)}>Bewerk</button>
                    <button className="pyd-ibtn" disabled={busy} onClick={() => save({ ...u, disabled: !u.disabled })}>{u.disabled ? "Zet aan" : "Zet uit"}</button>
                    <button className="pyd-ibtn" disabled={busy} title="Oude link werkt dan niet meer" onClick={() => window.confirm(`Nieuwe link voor ${u.name}? De oude link werkt dan niet meer.`) && call({ op: "reset", id: u.id })}>Nieuwe link</button>
                    <button className="pyd-ibtn" disabled={busy} style={{ color: "var(--err)" }} onClick={() => window.confirm(`Toegang van ${u.name} verwijderen?`) && call({ op: "delete", id: u.id })}>Verwijder</button>
                  </div>
                  <input type="text" className="pyx-link" readOnly value={typeof window !== "undefined" ? `${window.location.origin}/px/${u.token}` : ""} onFocus={(e) => e.target.select()} />
                  {openLog === u.id && (
                    <div className="pyx-log">
                      {!log.length && <div className="pyd-empty">Nog geen activiteit.</div>}
                      {log.map((e, i) => (
                        <div className="li" key={i}>
                          <span className="pyx-when">{when(e.at)}</span>
                          <span className="pyd-pill">{ACT[e.action] || e.action}</span>
                          <span className="grow">
                            {e.detail}
                            {e.titles && e.titles.length ? <span className="pyx-dim"> — {e.titles.join(", ")}</span> : null}
                          </span>
                          {(u.stores || []).length > 1 && <span className="pyx-dim">{nameOf(e.d)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="pyx-form">
          <h4>{editId ? "Bewerken" : "Iemand toevoegen"}</h4>
          <div className="fgrid">
            <label><div className="field-label">Naam</div><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="bijv. Cas" /></label>
            <label><div className="field-label">E-mailadres <span className="opt">hiermee logt hij in</span></div><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="info@…" /></label>
          </div>
          <div className="field-label">Welke store(s) mag hij zien</div>
          <div className="pyd-stores">
            {all.map((s) => {
              const d = cd(s.domain);
              return (
                <button key={d} type="button" className={`pyd-chip ${form.stores.includes(d) ? "on" : ""}`} onClick={() => toggleStore(d)}>
                  <span className="dot" />
                  {s.name || s.domain}
                </button>
              );
            })}
          </div>
          <label className="pyd-toggle" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={form.canEdit} onChange={(e) => setForm({ ...form, canEdit: e.target.checked })} /> mag producten op active / draft / archived zetten
          </label>
          <div className="pyd-box__foot">
            {editId && <button className="btn-ghost" onClick={() => { setEditId(""); setForm({ ...EMPTY, stores: sel ? [cd(sel)] : [] }); }}>Annuleren</button>}
            <button className="btn" disabled={busy || !form.name.trim() || !form.email.trim() || !form.stores.length} onClick={submit}>{editId ? "Opslaan" : "Toevoegen + link maken"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
