"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Lokale YYYY-MM-DD (geen UTC-shift zoals toISOString() geeft).
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// URL's in de omschrijving klikbaar maken
function renderDesc(text) {
  const parts = String(text || "").split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="todo-link" onClick={(e) => e.stopPropagation()}>
        {p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 46)}
        {p.length > 54 ? "…" : ""}
      </a>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

// Afbeelding client-side verkleinen naar max 900px JPEG (data-URL),
// zodat Redis (30MB free tier) niet volloopt met megafoto's.
async function compressImage(file) {
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const scale = Math.min(1, 900 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

const BUCKET_LABEL = {
  today: "Today",
  tomorrow: "Tomorrow",
  thisweek: "This Week",
  later: "Later",
};

function AddModal({ bucket, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addFiles = useCallback(async (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/")).slice(0, 4);
    for (const f of imgs) {
      try {
        const url = await compressImage(f);
        setImages((prev) => (prev.length >= 4 ? prev : [...prev, url]));
      } catch {}
    }
  }, []);

  const onPaste = useCallback(
    (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles]
  );

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    await onSave({ title: t, desc: desc.trim(), images });
    setBusy(false);
  };

  return (
    <div className="todo-overlay" onClick={onClose}>
      <div className="todo-modal" onClick={(e) => e.stopPropagation()} onPaste={onPaste}>
        <div className="todo-modal-head">
          <span>Nieuwe taak — {BUCKET_LABEL[bucket]}</span>
          <button type="button" className="todo-modal-x" onClick={onClose} aria-label="Sluiten">
            ✕
          </button>
        </div>

        <label className="todo-modal-label">Titel</label>
        <input
          type="text"
          value={title}
          autoFocus
          maxLength={120}
          placeholder="Korte titel…"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />

        <label className="todo-modal-label">
          Omschrijving <span className="opt">optioneel — links gewoon plakken, die worden klikbaar</span>
        </label>
        <textarea
          value={desc}
          maxLength={2000}
          placeholder={"Details, stappen, links…"}
          onChange={(e) => setDesc(e.target.value)}
        />

        <label className="todo-modal-label">
          Screenshots <span className="opt">optioneel — plak (Ctrl+V) of kies bestand, max 4</span>
        </label>
        <div className="todo-modal-imgs">
          {images.map((src, i) => (
            <span key={i} className="todo-thumb">
              <img src={src} alt="" />
              <button type="button" onClick={() => setImages(images.filter((_, j) => j !== i))} aria-label="Verwijder foto">
                ✕
              </button>
            </span>
          ))}
          {images.length < 4 ? (
            <label className="todo-thumb-add">
              +
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files || []);
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}
        </div>

        <div className="todo-modal-foot">
          <button type="button" className="btn-ghost btn-small" onClick={onClose}>
            Annuleren
          </button>
          <button type="button" className="btn btn-small" disabled={!title.trim() || busy} onClick={submit}>
            {busy ? "Bezig…" : "Toevoegen"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ item, open, onToggleOpen, onToggle, onDelete, onImage }) {
  const title = item.title || item.text || "";
  const hasDetails = Boolean((item.desc || "").trim() || (item.images || []).length);

  return (
    <div className={"todo-item" + (item.done ? " done" : "") + (open ? " open" : "")}>
      <div className="todo-row" onClick={() => hasDetails && onToggleOpen(item.id)}>
        <button
          type="button"
          className="todo-check"
          aria-label={item.done ? "Markeer als niet af" : "Markeer als af"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item);
          }}
        >
          {item.done ? (
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8.5 6.2 12 13 4" />
            </svg>
          ) : null}
        </button>
        <span className="todo-text">{title}</span>
        {hasDetails ? (
          <span className="todo-chev" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3.5 10.5 8 5 12.5" />
            </svg>
          </span>
        ) : null}
        <button
          type="button"
          className="todo-del"
          title={item.done ? "Verwijderen" : "Vink eerst af om te verwijderen"}
          disabled={!item.done}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16" />
            <path d="M9 7V4h6v3" />
            <path d="m6 7 1 13h10l1-13" />
          </svg>
        </button>
      </div>
      {open && hasDetails ? (
        <div className="todo-details">
          {(item.desc || "").trim() ? <p>{renderDesc(item.desc)}</p> : null}
          {(item.images || []).length ? (
            <div className="todo-details-imgs">
              {item.images.map((src, i) => (
                <img key={i} src={src} alt="" onClick={() => onImage(src)} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Column({ bucket, title, items, tone, onOpenAdd, rowProps }) {
  return (
    <div className={"todo-col" + (tone ? ` tone-${tone}` : "")}>
      <div className="todo-col-head">
        <span>{title}</span>
        <span className="todo-count">{items.length}</span>
      </div>
      <div className="todo-list">
        {items.length === 0 ? <div className="todo-empty">Niks hier</div> : items.map((it) => <Row key={it.id} item={it} {...rowProps} />)}
      </div>
      {onOpenAdd ? (
        <button type="button" className="todo-add-open" onClick={() => onOpenAdd(bucket)}>
          + Taak toevoegen
        </button>
      ) : null}
    </div>
  );
}

export default function TodoBoard() {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [modalBucket, setModalBucket] = useState(null);
  const [openIds, setOpenIds] = useState(() => new Set());
  const [lightbox, setLightbox] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/todos", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setTodos(data.todos || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = useMemo(() => new Date(), []);
  const todayStr = isoDate(today);
  const tomorrowStr = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return isoDate(d);
  }, [today]);

  const grouped = useMemo(() => {
    const g = { today: [], tomorrow: [], thisweek: [], later: [], overdue: [] };
    for (const t of todos) {
      if (t.date) {
        if (t.date === todayStr) g.today.push(t);
        else if (t.date === tomorrowStr) g.tomorrow.push(t);
        else if (t.date < todayStr) {
          if (!t.done) g.overdue.push(t);
        } else {
          g.later.push(t);
        }
      } else if (t.bucket === "thisweek") {
        g.thisweek.push(t);
      } else {
        g.later.push(t);
      }
    }
    return g;
  }, [todos, todayStr, tomorrowStr]);

  const reportError = useCallback(async (res, fallback) => {
    try {
      const data = await res.json();
      setErr((data && data.error) || fallback);
    } catch {
      setErr(fallback);
    }
  }, []);

  const saveTodo = useCallback(
    async ({ title, desc, images }) => {
      const bucket = modalBucket;
      const date = bucket === "today" ? todayStr : bucket === "tomorrow" ? tomorrowStr : undefined;
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, desc, images, bucket, date }),
      });
      if (res.ok) {
        setErr("");
        setModalBucket(null);
        load();
      } else {
        reportError(res, "Toevoegen mislukt");
      }
    },
    [modalBucket, load, todayStr, tomorrowStr, reportError]
  );

  const toggleTodo = useCallback(
    async (item) => {
      setTodos((prev) => prev.map((t) => (t.id === item.id ? { ...t, done: !t.done } : t)));
      const res = await fetch(`/api/todos/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !item.done }),
      });
      if (!res.ok) reportError(res, "Bijwerken mislukt");
      else setErr("");
      load();
    },
    [load, reportError]
  );

  const deleteTodo = useCallback(
    async (item) => {
      if (!item.done) return;
      setTodos((prev) => prev.filter((t) => t.id !== item.id));
      const res = await fetch(`/api/todos/${item.id}`, { method: "DELETE" });
      if (!res.ok) reportError(res, "Verwijderen mislukt");
      else setErr("");
      load();
    },
    [load, reportError]
  );

  const toggleOpen = useCallback((id) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (loading) return null;

  const rowProps = {
    onToggle: toggleTodo,
    onDelete: deleteTodo,
    onToggleOpen: toggleOpen,
    onImage: setLightbox,
  };
  const withOpen = (items) => items.map((it) => ({ ...it }));

  return (
    <section className="todo-board">
      <div className="todo-board-head">
        <span className="todo-board-title">To Do</span>
        {err ? <span className="todo-err">{err}</span> : null}
      </div>
      <div className="todo-cols">
        <Column
          bucket="today"
          title="Today"
          items={withOpen(grouped.today)}
          onOpenAdd={setModalBucket}
          rowProps={{ ...rowProps }}
        />
        {grouped.overdue.length > 0 ? (
          <Column bucket="overdue" title="Yesterday · unfinished" items={withOpen(grouped.overdue)} tone="overdue" rowProps={{ ...rowProps }} />
        ) : null}
        <Column bucket="tomorrow" title="Tomorrow" items={withOpen(grouped.tomorrow)} onOpenAdd={setModalBucket} rowProps={{ ...rowProps }} />
        <Column bucket="thisweek" title="This Week" items={withOpen(grouped.thisweek)} onOpenAdd={setModalBucket} rowProps={{ ...rowProps }} />
        <Column bucket="later" title="Later" items={withOpen(grouped.later)} onOpenAdd={setModalBucket} rowProps={{ ...rowProps }} />
      </div>

      {modalBucket ? <AddModal bucket={modalBucket} onClose={() => setModalBucket(null)} onSave={saveTodo} /> : null}

      {lightbox ? (
        <div className="todo-overlay" onClick={() => setLightbox(null)}>
          <img className="todo-lightbox" src={lightbox} alt="" />
        </div>
      ) : null}
    </section>
  );
}
