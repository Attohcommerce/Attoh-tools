"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Lokale YYYY-MM-DD (geen UTC-shift zoals toISOString() geeft).
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DAY_COLUMNS = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
];
const PLAIN_COLUMNS = [
  { key: "thisweek", label: "This Week" },
  { key: "later", label: "Later" },
];

function Row({ item, onToggle, onDelete }) {
  return (
    <div className={"todo-row" + (item.done ? " done" : "")}>
      <button
        type="button"
        className="todo-check"
        aria-label={item.done ? "Markeer als niet af" : "Markeer als af"}
        onClick={() => onToggle(item)}
      >
        {item.done ? (
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5 6.2 12 13 4" />
          </svg>
        ) : null}
      </button>
      <span className="todo-text">{item.text}</span>
      <button
        type="button"
        className="todo-del"
        title={item.done ? "Verwijderen" : "Vink eerst af om te verwijderen"}
        disabled={!item.done}
        onClick={() => onDelete(item)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="m6 7 1 13h10l1-13" />
        </svg>
      </button>
    </div>
  );
}

function Column({ title, items, tone, onAdd, onToggle, onDelete, addPlaceholder }) {
  const [draft, setDraft] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
  };

  return (
    <div className={"todo-col" + (tone ? ` tone-${tone}` : "")}>
      <div className="todo-col-head">
        <span>{title}</span>
        <span className="todo-count">{items.length}</span>
      </div>
      <div className="todo-list">
        {items.length === 0 ? (
          <div className="todo-empty">Niks hier</div>
        ) : (
          items.map((it) => (
            <Row key={it.id} item={it} onToggle={onToggle} onDelete={onDelete} />
          ))
        )}
      </div>
      {onAdd ? (
        <form className="todo-add" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={addPlaceholder || "Nieuwe taak…"}
            maxLength={200}
          />
          <button type="submit" className="todo-add-btn" aria-label="Toevoegen">
            +
          </button>
        </form>
      ) : null}
    </div>
  );
}

export default function TodoBoard() {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);

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
          // datum verder in de toekomst dan morgen — voor de zekerheid toch tonen
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

  const addTodo = useCallback(
    async (bucket, text) => {
      const date = bucket === "today" ? todayStr : bucket === "tomorrow" ? tomorrowStr : undefined;
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, bucket, date }),
      });
      if (res.ok) load();
    },
    [load, todayStr, tomorrowStr]
  );

  const toggleTodo = useCallback(
    async (item) => {
      setTodos((prev) => prev.map((t) => (t.id === item.id ? { ...t, done: !t.done } : t)));
      await fetch(`/api/todos/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !item.done }),
      });
      load();
    },
    [load]
  );

  const deleteTodo = useCallback(
    async (item) => {
      if (!item.done) return;
      setTodos((prev) => prev.filter((t) => t.id !== item.id));
      await fetch(`/api/todos/${item.id}`, { method: "DELETE" });
      load();
    },
    [load]
  );

  if (loading) return null;

  return (
    <section className="todo-board">
      <div className="todo-board-head">
        <span className="todo-board-title">To Do</span>
      </div>
      <div className="todo-cols">
        <Column
          title="Today"
          items={grouped.today}
          onAdd={(text) => addTodo("today", text)}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
          addPlaceholder="Vandaag te doen…"
        />
        {grouped.overdue.length > 0 ? (
          <Column
            title="Yesterday · unfinished"
            items={grouped.overdue}
            tone="overdue"
            onToggle={toggleTodo}
            onDelete={deleteTodo}
          />
        ) : null}
        <Column
          title="Tomorrow"
          items={grouped.tomorrow}
          onAdd={(text) => addTodo("tomorrow", text)}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
          addPlaceholder="Morgen te doen…"
        />
        <Column
          title="This Week"
          items={grouped.thisweek}
          onAdd={(text) => addTodo("thisweek", text)}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
          addPlaceholder="Deze week…"
        />
        <Column
          title="Later"
          items={grouped.later}
          onAdd={(text) => addTodo("later", text)}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
          addPlaceholder="Ooit nog…"
        />
      </div>
    </section>
  );
}
