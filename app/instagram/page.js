"use client";

// Verstopte module — geen menu-knop; bereikbaar via /instagram.
// Alleen USER1 (Justin) krijgt data; anderen zien "geen toegang".
import { useCallback, useEffect, useState } from "react";
import Header from "../components/Header";

// Snippet die Justin in de browser-console op instagram.com draait terwijl
// de volgers-dialoog openstaat: scrollt de lijst leeg en kopieert alle
// usernames naar het klembord.
const SNIPPET = `(async()=>{const d=document.querySelector('div[role="dialog"]');if(!d){alert('Open eerst de volgers-lijst');return}const box=[...d.querySelectorAll('div')].find(x=>x.scrollHeight>x.clientHeight&&x.clientHeight>200);const names=new Set();let still=0;while(still<6){d.querySelectorAll('a[href^="/"]').forEach(a=>{const u=a.getAttribute('href').replaceAll('/','');if(/^[a-z0-9._]{1,30}$/i.test(u))names.add(u)});const n=names.size;box.scrollTop=box.scrollHeight;await new Promise(r=>setTimeout(r,900));still=names.size===n?still+1:0}const list=[...names].join('\\n');await navigator.clipboard.writeText(list);alert(names.size+' volgers gekopieerd — plak in Attoh Tools')})()`;

function fmtTs(ts) {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function InstagramPage() {
  const [allowed, setAllowed] = useState(null); // null = checken
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [detail, setDetail] = useState(null); // {account, snapshots, diff}
  const [selA, setSelA] = useState(null);
  const [selB, setSelB] = useState(null);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/instagram");
    if (res.status === 403) {
      setAllowed(false);
      return;
    }
    setAllowed(true);
    const data = await res.json();
    setAccounts(data.accounts || []);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  async function openAccount(name, a = null, b = null) {
    const qs = new URLSearchParams({ account: name });
    if (a !== null) qs.set("a", String(a));
    if (b !== null) qs.set("b", String(b));
    const res = await fetch(`/api/instagram?${qs}`);
    const data = await res.json();
    if (res.ok) {
      setDetail(data);
      setSelA(a);
      setSelB(b);
    }
  }

  async function saveSnapshot() {
    if (busy || !account.trim() || !text.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      let m = `Snapshot opgeslagen: ${data.count} volgers van @${data.account}.`;
      if (data.diff) {
        m += ` T.o.v. ${fmtTs(data.diff.prevTs)}: +${data.diff.added.length} / −${data.diff.removed.length}.`;
      }
      setMsg(m);
      setText("");
      loadAccounts();
      openAccount(data.account);
    } catch (e) {
      setMsg("Fout: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(name) {
    if (!confirm(`Alle snapshots van @${name} verwijderen?`)) return;
    await fetch(`/api/instagram?account=${encodeURIComponent(name)}`, { method: "DELETE" });
    setDetail(null);
    loadAccounts();
  }

  if (allowed === false) {
    return (
      <>
        <Header icon="I" title="Instagram" subtitle="Volgers-tracker" />
        <div className="page">
          <div className="card">
            <div className="center-note">Deze module is niet beschikbaar voor dit account.</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header icon="I" title="Instagram" subtitle="Volgers-tracker" />
      <div className="page layout-2col">
        <div>
          <div className="card">
            <h2>Snapshot opslaan</h2>
            <div className="field-label">Instagram-account</div>
            <input
              type="text"
              placeholder="@accountnaam"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
            <div className="field-label">Volgerslijst plakken</div>
            <textarea
              rows={8}
              placeholder={"één username per regel — of plak gewoon de hele gekopieerde volgers-dialoog, rommel wordt er automatisch uitgefilterd"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={saveSnapshot} disabled={busy || !account.trim() || !text.trim()}>
                {busy ? "Opslaan…" : "⎘ Snapshot opslaan"}
              </button>
            </div>
            {msg && <div className="hint">{msg}</div>}
            <div className="hint" style={{ marginTop: 14 }}>
              Snel de lijst pakken: open op instagram.com de volgers-dialoog van het account, plak
              dit in de browser-console (F12) en druk op Enter — de hele lijst wordt automatisch
              gescrold en gekopieerd:
            </div>
            <textarea readOnly rows={3} value={SNIPPET} onFocus={(e) => e.target.select()} style={{ fontSize: 11 }} />
          </div>

          <div className="card">
            <h2>Gevolgde accounts</h2>
            {accounts.length === 0 && <div className="center-note">Nog geen snapshots.</div>}
            {accounts.map((a) => (
              <div className="log" key={a.account} style={{ cursor: "pointer" }} onClick={() => openAccount(a.account)}>
                <span style={{ flex: 1 }}>
                  <strong>@{a.account}</strong>{" "}
                  <span className="muted small">
                    {a.lastCount} volgers · {a.snapshots} snapshots · laatst {a.lastTs ? fmtTs(a.lastTs) : "—"}
                  </span>
                </span>
                <button
                  className="linklike"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAccount(a.account);
                  }}
                >
                  verwijderen
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="card" style={{ minHeight: 300 }}>
            <h2>Verschillen{detail ? ` — @${detail.account}` : ""}</h2>
            {!detail && <div className="center-note">Klik links op een account om de verschillen te zien.</div>}
            {detail && detail.snapshots.length < 2 && (
              <div className="center-note">
                Eén snapshot opgeslagen — plak over een tijdje de lijst opnieuw, dan zie je hier exact
                wie erbij is gekomen en wie is weggegaan.
              </div>
            )}
            {detail && detail.snapshots.length >= 2 && (
              <>
                <div className="hint" style={{ marginTop: 0 }}>
                  Vergelijk:
                  <select
                    style={{ width: "auto", display: "inline-block", margin: "0 6px" }}
                    value={selA === null ? detail.snapshots.length - 2 : selA}
                    onChange={(e) => openAccount(detail.account, Number(e.target.value), selB === null ? detail.snapshots.length - 1 : selB)}
                  >
                    {detail.snapshots.map((s) => (
                      <option key={s.i} value={s.i}>{fmtTs(s.ts)} ({s.count})</option>
                    ))}
                  </select>
                  →
                  <select
                    style={{ width: "auto", display: "inline-block", margin: "0 6px" }}
                    value={selB === null ? detail.snapshots.length - 1 : selB}
                    onChange={(e) => openAccount(detail.account, selA === null ? detail.snapshots.length - 2 : selA, Number(e.target.value))}
                  >
                    {detail.snapshots.map((s) => (
                      <option key={s.i} value={s.i}>{fmtTs(s.ts)} ({s.count})</option>
                    ))}
                  </select>
                </div>
                {detail.diff && (
                  <>
                    <div className="field-label" style={{ color: "var(--ok)" }}>
                      Nieuw ({detail.diff.added.length})
                    </div>
                    <div className="hint" style={{ marginTop: 0, wordBreak: "break-word" }}>
                      {detail.diff.added.length
                        ? detail.diff.added.map((u) => (
                            <a key={u} href={`https://instagram.com/${u}`} target="_blank" rel="noreferrer noopener" className="linklike" style={{ marginRight: 10 }}>
                              @{u}
                            </a>
                          ))
                        : "—"}
                    </div>
                    <div className="field-label" style={{ color: "var(--err)" }}>
                      Weg ({detail.diff.removed.length})
                    </div>
                    <div className="hint" style={{ marginTop: 0, wordBreak: "break-word" }}>
                      {detail.diff.removed.length
                        ? detail.diff.removed.map((u) => (
                            <a key={u} href={`https://instagram.com/${u}`} target="_blank" rel="noreferrer noopener" className="linklike" style={{ marginRight: 10 }}>
                              @{u}
                            </a>
                          ))
                        : "—"}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
