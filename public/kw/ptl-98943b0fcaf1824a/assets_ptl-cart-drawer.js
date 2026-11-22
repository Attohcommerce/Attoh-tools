/* Pierre the Label cart drawer (22-11-2026, from the Code of Clothes cart). Clean, conversion-first cart: discount steps,
   ship-by date, variant selects, savings, "You may also like" with quick add and a shipping
   protection toggle that is on by default. Line keys can change when discounts move, so every
   request looks the key up again. */
(function () {
  if (window.customElements.get('ptl-cart-drawer')) return;
  var ROOT = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  var SECTION = 'ptl-cart-drawer';
  var RECS = 'ptl-cart-recs';
  var OPT_OUT = 'ptl_sp_off';

  function optedOut() {
    try { return window.localStorage.getItem(OPT_OUT) === '1'; } catch (e) { return false; }
  }
  function setOptOut(on) {
    try {
      if (on) window.localStorage.setItem(OPT_OUT, '1');
      else window.localStorage.removeItem(OPT_OUT);
    } catch (e) {}
  }
  function post(path, body) {
    return fetch(ROOT + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.description || j.message || 'Something went wrong');
        return j;
      });
    });
  }
  function getCart() {
    return fetch(ROOT + 'cart.js', { credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }
  function isHash(o) {
    return !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0;
  }
  function propsKey(o) {
    return JSON.stringify(isHash(o) ? o : null);
  }
  function parse(html) {
    return new DOMParser().parseFromString(html || '', 'text/html');
  }

  class PtlCartDrawer extends HTMLElement {
    connectedCallback() {
      if (this.ready) return;
      this.ready = true;
      this.queue = Promise.resolve();
      this.pending = 0;
      this.recsKey = '';
      this.recsHTML = '';
      this.recsToken = 0;
      this.panel = this.querySelector('.ptl-cart__panel');
      this.addEventListener('click', this.onClick.bind(this));
      this.addEventListener('change', this.onChange.bind(this));
      this.addEventListener('submit', this.onSubmit.bind(this));
      var self = this;
      document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('#cart-icon-bubble, [data-cart-toggle]') : null;
        if (!t || self.contains(t)) return;
        e.preventDefault();
        self.open();
        self.run(function () { return self.refresh(); });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.isOpen()) self.close();
      });
      document.addEventListener('cart:add', function () {
        self.open();
        self.run(function () { return self.refresh(); });
      });
      window.addEventListener('pageshow', function (e) {
        if (e.persisted) self.run(function () { return self.refresh(); });
      });
      this.decorate();
      this.run(function () { return self.ensure(); });
    }

    isOpen() { return this.classList.contains('is-open'); }

    open() {
      this.classList.add('is-open');
      this.setAttribute('aria-hidden', 'false');
      document.documentElement.classList.add('ptl-cart-lock');
      var p = this.panel;
      window.setTimeout(function () { try { p.focus({ preventScroll: true }); } catch (e) {} }, 60);
      this.loadRecs();
    }

    close() {
      this.classList.remove('is-open');
      this.setAttribute('aria-hidden', 'true');
      document.documentElement.classList.remove('ptl-cart-lock');
    }

    run(task) {
      var self = this;
      this.pending += 1;
      this.classList.add('is-busy');
      this.queue = this.queue.then(task).catch(function (err) {
        var msg = err && err.message;
        return self.refresh().catch(function () {}).then(function () { self.flash(msg); });
      }).then(function () {
        self.pending -= 1;
        if (self.pending <= 0) {
          self.pending = 0;
          self.classList.remove('is-busy');
        }
      });
      return this.queue;
    }

    state() { return this.querySelector('[data-state]'); }

    keyFor(variant, fallback) {
      var el = variant ? this.querySelector('[data-line][data-variant="' + variant + '"]') : null;
      return (el && el.dataset.line) || fallback;
    }

    render(html) {
      if (!html) return;
      var fresh = parse(html).querySelector('[data-ptl-cart-inner]');
      var inner = this.querySelector('[data-ptl-cart-inner]');
      if (fresh && inner) inner.innerHTML = fresh.innerHTML;
      this.decorate();
    }

    refresh() {
      var self = this;
      return fetch(ROOT + '?sections=' + SECTION, { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          self.render(j[SECTION]);
          return self.ensure();
        });
    }

    mutate(path, body) {
      var self = this;
      body.sections = SECTION;
      body.sections_url = window.location.pathname;
      return post(path, body).then(function (j) {
        if (j && j.sections && j.sections[SECTION]) self.render(j.sections[SECTION]);
        else return self.refresh();
      });
    }

    act(path, body) {
      var self = this;
      return this.mutate(path, body).then(function () { return self.ensure(); });
    }

    ensure() {
      var st = this.state();
      if (!st) return null;
      var count = Number(st.dataset.count || 0);
      var key = st.dataset.spKey;
      var qty = Number(st.dataset.spQty || 0);
      var variant = st.dataset.spVariant;
      if (key && count === 0) return this.mutate('cart/change.js', { id: key, quantity: 0 });
      if (key && qty > 1) return this.mutate('cart/change.js', { id: key, quantity: 1 });
      if (!key && count > 0 && variant && st.dataset.spAuto === 'true' && !optedOut()) {
        return this.mutate('cart/add.js', { items: [{ id: Number(variant), quantity: 1 }] }).catch(function () {});
      }
      return null;
    }

    writeCount() {
      var st = this.state();
      if (!st) return;
      var n = Number(st.dataset.count || 0);
      document.querySelectorAll('[data-cart-count]').forEach(function (c) {
        c.textContent = n;
        c.classList.toggle('is-empty', n === 0);
      });
    }

    decorate() {
      var self = this;
      var st = this.state();
      var count = st ? Number(st.dataset.count || 0) : 0;
      var tiers = Array.prototype.slice.call(this.querySelectorAll('[data-tier]'));
      var fill = this.querySelector('[data-fill]');
      if (fill && tiers.length) {
        var qs = tiers.map(function (t) { return Number(t.dataset.qty) || 0; });
        var n = qs.length;
        var pct = 100;
        var prev = 0;
        for (var i = 0; i < n; i++) {
          if (count < qs[i]) {
            var span = (qs[i] - prev) || 1;
            pct = ((i + (count - prev) / span) / n) * 100;
            break;
          }
          prev = qs[i];
        }
        window.requestAnimationFrame(function () { fill.style.width = Math.max(0, Math.min(100, pct)) + '%'; });
      }
      this.fillEta();
      this.querySelectorAll('[data-line]').forEach(function (line) { self.markOptions(line); });
      this.writeCount();
      window.clearTimeout(this.countTimer);
      this.countTimer = window.setTimeout(function () { self.writeCount(); }, 900);
      if (this.isOpen()) this.loadRecs();
    }

    fillEta() {
      var el = this.querySelector('[data-shipby-date]');
      if (!el) return;
      var d = new Date();
      d.setDate(d.getDate() + (parseInt(this.dataset.shipDays, 10) || 0));
      if (this.dataset.shipSkip === 'true') {
        if (d.getDay() === 6) d.setDate(d.getDate() + 2);
        if (d.getDay() === 0) d.setDate(d.getDate() + 1);
      }
      try {
        el.textContent = d.toLocaleDateString(this.dataset.shipLocale || 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      } catch (e) {
        el.textContent = d.toDateString();
      }
    }

    loadRecs() {
      var box = this.querySelector('[data-recs]');
      var st = this.state();
      if (!box || !st) return;
      var row = box.querySelector('[data-recs-row]');
      var first = st.dataset.first;
      if (!first || !row) { box.hidden = true; return; }
      var key = first + '|' + st.dataset.ids;
      if (key === this.recsKey) {
        if (this.recsHTML) { row.innerHTML = this.recsHTML; box.hidden = false; }
        return;
      }
      this.recsKey = key;
      this.recsHTML = '';
      var self = this;
      var token = ++this.recsToken;
      var url = (this.dataset.recsUrl || ROOT + 'recommendations/products') + '?product_id=' + encodeURIComponent(first) + '&limit=10&intent=related&section_id=' + RECS;
      var pick = function (html) {
        var list = parse(html).querySelector('[data-ptl-recs]');
        return list && list.querySelector('.ptl-cart__rec') ? list.innerHTML : '';
      };
      fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
        var out = pick(html);
        if (out || !self.dataset.recsFallback) return out;
        var sep = self.dataset.recsFallback.indexOf('?') === -1 ? '?' : '&';
        return fetch(self.dataset.recsFallback + sep + 'section_id=' + RECS, { credentials: 'same-origin' })
          .then(function (r) { return r.text(); }).then(pick);
      }).then(function (out) {
        if (token !== self.recsToken) return;
        self.recsHTML = out || '';
        var liveBox = self.querySelector('[data-recs]');
        var liveRow = liveBox && liveBox.querySelector('[data-recs-row]');
        if (!liveRow) return;
        liveRow.innerHTML = self.recsHTML;
        self.labelRecs(liveRow);
        self.recsHTML = liveRow.innerHTML;
        liveBox.hidden = !self.recsHTML;
      }).catch(function () {});
    }

    labelRecs(row) {
      var ph = this.dataset.recsSelect;
      var add = this.dataset.recsAdd;
      if (ph) row.querySelectorAll('[data-rec-ph]').forEach(function (o) { o.textContent = ph; });
      if (add) row.querySelectorAll('[data-rec-label]').forEach(function (s) { s.textContent = add; });
    }

    variants(line) {
      var el = line.querySelector('[data-variants]');
      try { return JSON.parse(el ? el.textContent : '[]'); } catch (e) { return []; }
    }

    markOptions(line) {
      var list = this.variants(line);
      line.querySelectorAll('select[data-opt]').forEach(function (sel) {
        var idx = Number(sel.dataset.opt);
        Array.prototype.forEach.call(sel.options, function (opt) {
          opt.disabled = !opt.selected && !list.some(function (v) { return v.a && v.o[idx] === opt.value; });
        });
      });
    }

    flash(msg) {
      var el = this.querySelector('[data-flash]');
      if (!el || !msg) return;
      el.textContent = msg;
      el.hidden = false;
      window.clearTimeout(this.flashTimer);
      this.flashTimer = window.setTimeout(function () { el.hidden = true; }, 4000);
    }

    onClick(e) {
      var t = e.target;
      var self = this;
      if (t.closest('[data-close]')) {
        e.preventDefault();
        this.close();
        return;
      }
      if (t.closest('[data-close-link]')) {
        this.close();
        return;
      }
      var recAdd = t.closest('[data-rec-add]');
      if (recAdd) {
        var form = recAdd.closest('[data-rec]');
        var field = form ? form.querySelector('[data-rec-variant]') : null;
        var vid = field ? field.value : '';
        if (!vid) {
          var wrap = field ? field.closest('.ptl-cart__select') : null;
          if (wrap) {
            wrap.classList.remove('is-invalid');
            void wrap.offsetWidth;
            wrap.classList.add('is-invalid');
          }
          if (field && field.focus) field.focus();
          return;
        }
        recAdd.classList.add('is-loading');
        this.run(function () { return self.act('cart/add.js', { items: [{ id: Number(vid), quantity: 1 }] }); });
        return;
      }
      var step = t.closest('[data-qty-step]');
      if (step) {
        var line = step.closest('[data-line]');
        if (!line) return;
        var next = Math.max(0, Number(line.dataset.qty || 1) + Number(step.dataset.qtyStep || 0));
        line.dataset.qty = String(next);
        var label = line.querySelector('.ptl-cart__qty span');
        if (label) label.textContent = next;
        var lineVid = line.dataset.variant;
        var key = line.dataset.line;
        this.run(function () { return self.act('cart/change.js', { id: self.keyFor(lineVid, key), quantity: next }); });
        return;
      }
      var rm = t.closest('[data-remove]');
      if (rm) {
        var row = rm.closest('[data-line]');
        if (!row) return;
        row.classList.add('is-removing');
        var rowVid = row.dataset.variant;
        var rowKey = row.dataset.line;
        this.run(function () { return self.act('cart/change.js', { id: self.keyFor(rowVid, rowKey), quantity: 0 }); });
      }
    }

    onChange(e) {
      var t = e.target;
      var self = this;
      if (t.matches('[data-rec-variant]')) {
        var wrap = t.closest('.ptl-cart__select');
        if (wrap) wrap.classList.remove('is-invalid');
        return;
      }
      if (t.matches('[data-protect]')) {
        var st = this.state();
        if (t.checked) {
          setOptOut(false);
          var v = st ? st.dataset.spVariant : '';
          if (v) this.run(function () { return self.mutate('cart/add.js', { items: [{ id: Number(v), quantity: 1 }] }); });
        } else {
          setOptOut(true);
          this.run(function () {
            var now = self.state();
            var k = now ? now.dataset.spKey : '';
            return k ? self.mutate('cart/change.js', { id: k, quantity: 0 }) : null;
          });
        }
        return;
      }
      if (t.matches('select[data-opt]')) {
        var line = t.closest('[data-line]');
        if (!line) return;
        var selects = Array.prototype.slice.call(line.querySelectorAll('select[data-opt]'));
        var want = selects.map(function (s) { return s.value; });
        var idx = Number(t.dataset.opt);
        var list = this.variants(line);
        var match = list.filter(function (v) {
          return v.a && v.o.every(function (o, i) { return o === want[i]; });
        })[0] || list.filter(function (v) { return v.a && v.o[idx] === want[idx]; })[0];
        if (!match) {
          this.run(function () { return Promise.reject(new Error(self.dataset.soldOut || 'This option is sold out')); });
          return;
        }
        var oldVariant = Number(line.dataset.variant);
        var props = null;
        try { props = JSON.parse(line.dataset.props || '{}'); } catch (err) { props = null; }
        var item = { id: match.id, quantity: Number(line.dataset.qty || 1) };
        if (isHash(props)) item.properties = props;
        var oldProps = propsKey(props);
        line.classList.add('is-removing');
        this.run(function () {
          return post('cart/add.js', { items: [item] }).then(getCart).then(function (cart) {
            var lines = cart.items.filter(function (i) { return i.variant_id === oldVariant; });
            var old = lines.filter(function (i) { return propsKey(i.properties) === oldProps; })[0] || lines[0];
            if (!old) return self.refresh();
            return self.act('cart/change.js', { id: old.key, quantity: 0 });
          });
        });
      }
    }

    onSubmit(e) {
      var form = e.target;
      if (!form.matches || !form.matches('[data-checkout-form]')) return;
      e.preventDefault();
      var btn = form.querySelector('[data-checkout]');
      if (btn) btn.classList.add('is-loading');
      this.queue.then(function () { window.location.href = ROOT + 'checkout'; });
    }
  }

  window.customElements.define('ptl-cart-drawer', PtlCartDrawer);
})();

/* v4.2 (19-11): arrows for the "Complete your look" row, three full cards per step */
(function () {
  function rowOf(el) {
    var box = el && el.closest('[data-recs]');
    return box ? box.querySelector('[data-recs-row]') : null;
  }
  function sync(row) {
    var box = row.closest('[data-recs]');
    var nav = box && box.querySelector('[data-recs-nav]');
    if (!nav) return;
    var max = row.scrollWidth - row.clientWidth;
    var hide = max <= 4;
    if (nav.hidden !== hide) nav.hidden = hide;
    var prev = nav.querySelector('[data-recs-prev]');
    var next = nav.querySelector('[data-recs-next]');
    var atStart = row.scrollLeft <= 4;
    var atEnd = row.scrollLeft >= max - 4;
    if (prev && prev.disabled !== atStart) prev.disabled = atStart;
    if (next && next.disabled !== atEnd) next.disabled = atEnd;
  }
  function syncAll() {
    document.querySelectorAll('ptl-cart-drawer [data-recs-row]').forEach(sync);
  }
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-recs-prev], [data-recs-next]') : null;
    if (!btn) return;
    var row = rowOf(btn);
    if (!row) return;
    var card = row.querySelector('.ptl-cart__rec');
    var gap = parseFloat(window.getComputedStyle(row).columnGap) || 0;
    var step = card ? (card.getBoundingClientRect().width + gap) * 3 : row.clientWidth;
    row.scrollBy({ left: btn.hasAttribute('data-recs-next') ? step : -step, behavior: 'smooth' });
  });
  document.addEventListener('scroll', function (e) {
    if (e.target && e.target.matches && e.target.matches('[data-recs-row]')) sync(e.target);
  }, true);
  window.addEventListener('resize', syncAll);
  function watch() {
    var drawer = document.querySelector('ptl-cart-drawer');
    if (!drawer) return;
    new MutationObserver(function () { window.requestAnimationFrame(syncAll); }).observe(drawer, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden'] });
    syncAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
