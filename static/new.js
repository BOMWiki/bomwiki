// The "create a page" island. Builds a new product/assembly/part from
// scratch: name, kind, summary, article, and a bill of materials assembled
// with the same part-picker as the in-place editor (existing parts, or new
// ones created inline). Proposes one create changeset via the same API, so
// review, trust ladder, and validation are identical to any other edit.
(function () {
  'use strict';

  var mount = document.getElementById('bw-new');
  if (!mount || !mount.getAttribute('data-signedin')) return;

  var work = { name: '', kind: 'product', bom: [] };
  var creates = []; // inline-created child parts: { id, name, kind }
  var names = {}; // childId -> display name, for the change list
  var domains = [];
  try {
    var dEl = document.getElementById('bw-domains');
    if (dEl) domains = JSON.parse(dEl.textContent);
  } catch (e) { domains = []; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function nameOf(id) {
    for (var i = 0; i < creates.length; i++) if (creates[i].id === id) return creates[i].name;
    return names[id] || id;
  }

  var slugNote = el('p', { class: 'ed-sub', text: '' });
  var existsNote = el('p', { class: 'ed-errors' });
  existsNote.hidden = true;
  var rowsEl = el('div', { class: 'ed-rows' });
  var barEl = el('div', { class: 'ed-bar' });

  function updateSlug() {
    var slug = slugify(work.name || '');
    slugNote.textContent = slug
      ? 'Page URL: /item/' + slug + '/'
      : 'Type a name to get a page address.';
    checkExists(slug, work.name);
  }

  var existsTimer = null;
  function checkExists(slug, name) {
    clearTimeout(existsTimer);
    existsNote.hidden = true;
    if (!name || !name.trim()) return;
    existsTimer = setTimeout(function () {
      fetch('/api/search?q=' + encodeURIComponent(name.trim()))
        .then(function (r) { return r.json(); })
        .then(function (hits) {
          var exact = hits.filter(function (h) {
            return h.id === slug || h.name.toLowerCase() === name.trim().toLowerCase();
          })[0];
          if (!exact) { existsNote.hidden = true; return; }
          existsNote.innerHTML = '';
          existsNote.appendChild(document.createTextNode('A page like this may already exist: '));
          existsNote.appendChild(el('a', { href: '/item/' + exact.id + '/', text: exact.name }));
          existsNote.appendChild(document.createTextNode('. Edit that instead of creating a duplicate.'));
          existsNote.hidden = false;
        })
        .catch(function () {});
    }, 250);
  }

  function bomRow(line) {
    var qty = el('input', {
      type: 'number', min: '1', step: '1', value: String(line.qty),
      oninput: function () { line.qty = Math.max(1, Math.round(Number(qty.value) || 1)); renderBar(); },
    });
    var note = el('input', {
      type: 'text', value: line.note || '', placeholder: 'Note',
      oninput: function () { if (note.value.trim()) line.note = note.value.trim(); else delete line.note; renderBar(); },
    });
    var row = el('div', { class: 'ed-row', 'data-id': line.id }, [
      el('span', { class: 'ed-name', text: nameOf(line.id) || line.id }),
      qty,
      note,
      el('button', {
        type: 'button', class: 'ed-del', 'aria-label': 'Remove ' + line.id, text: '×',
        onclick: function () {
          work.bom = work.bom.filter(function (l) { return l !== line; });
          creates = creates.filter(function (c) { return c.id !== line.id; });
          row.remove();
          renderBar();
        },
      }),
    ]);
    return row;
  }

  function picker() {
    var input = el('input', { type: 'text', class: 'ed-pick', placeholder: 'Add a part by name…' });
    var list = el('div', { class: 'ed-pick-list' });
    var timer = null;

    function addLine(id, name) {
      if (work.bom.some(function (l) { return l.id === id; })) return;
      var line = { id: id, qty: 1 };
      work.bom.push(line);
      rowsEl.appendChild(bomRow(line));
      rowsEl.lastChild.querySelector('.ed-name').textContent = name;
      input.value = '';
      list.innerHTML = '';
      renderBar();
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (!q) { list.innerHTML = ''; return; }
      timer = setTimeout(function () {
        fetch('/api/search?q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (hits) {
            list.innerHTML = '';
            hits.forEach(function (h) {
              list.appendChild(el('button', {
                type: 'button', class: 'ed-pick-hit',
                text: h.name + ' · ' + h.kind + (h.usedIn ? ', used in ' + h.usedIn : ''),
                onclick: function () { addLine(h.id, h.name); },
              }));
            });
            var slug = slugify(q);
            if (slug.length >= 2) {
              list.appendChild(el('button', {
                type: 'button', class: 'ed-pick-hit ed-pick-new',
                text: '+ Create new part "' + q + '"',
                onclick: function () {
                  creates.push({ id: slug, name: q, kind: 'part' });
                  addLine(slug, q);
                },
              }));
            }
          });
      }, 150);
    });
    return el('div', { class: 'ed-add' }, [input, list]);
  }

  function renderBar() {
    barEl.innerHTML = '';
    var problems = [];
    if (!work.name || !work.name.trim()) problems.push('a name');
    if (slugify(work.name || '').length < 2) problems.push('a longer name (2+ letters)');
    var summary = [];
    summary.push('New ' + work.kind + ' "' + (work.name || '…') + '"');
    if (work.bom.length) summary.push(work.bom.length + ' part' + (work.bom.length > 1 ? 's' : ''));
    if (creates.length) summary.push(creates.length + ' new part' + (creates.length > 1 ? 's' : '') + ' created');
    barEl.appendChild(el('p', { class: 'ed-bar-h', text: 'This will create' }));
    var ul = el('ul', { class: 'ed-lines' });
    summary.forEach(function (s) { ul.appendChild(el('li', { text: s })); });
    barEl.appendChild(ul);
    var btn = el('button', {
      type: 'button', class: 'ed-propose', text: 'Create page', onclick: submit,
    });
    if (problems.length) { btn.disabled = true; }
    barEl.appendChild(el('div', { class: 'ed-bar-actions' }, [
      btn,
      el('span', { class: 'ed-hint', text: problems.length ? 'Needs ' + problems.join(' and ') : 'Goes to review, then live' }),
    ]));
  }

  function submit() {
    var slug = slugify(work.name || '');
    var data = { name: work.name.trim(), kind: work.kind };
    if (work.kind === 'product' && work.domain) data.domain = work.domain;
    if (work.summary) data.summary = work.summary;
    if (work.article) data.article = work.article;
    if (work.bom.length) data.bom = work.bom;
    var edits = creates
      .filter(function (c) { return c.id !== slug; })
      .map(function (c) { return { op: 'create', nodeId: c.id, data: { name: c.name, kind: c.kind } }; });
    edits.push({ op: 'create', nodeId: slug, data: data });
    fetch('/api/changesets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ edits: edits }),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (r) {
        if (r.status === 201) {
          if (r.body.applied) { window.location.href = '/item/' + slug + '/'; return; }
          mount.innerHTML = '';
          var ok = el('p', { class: 'ed-done' });
          ok.appendChild(document.createTextNode('Change #' + r.body.id + ' submitted. A reviewer will check it before the page goes live. '));
          ok.appendChild(el('a', { href: '/changeset/' + r.body.id, text: 'Track it here' }));
          ok.appendChild(document.createTextNode('.'));
          mount.appendChild(ok);
        } else {
          existsNote.textContent = (r.body.errors || [r.body.error || 'failed']).join('; ');
          existsNote.hidden = false;
        }
      })
      .catch(function () {
        existsNote.textContent = 'Something went wrong. Try again.';
        existsNote.hidden = false;
      });
  }

  var nameInput = el('input', {
    type: 'text', placeholder: 'Name (e.g. Fish Vaccination Machine)', maxlength: '120',
    oninput: function () { work.name = nameInput.value; updateSlug(); renderBar(); },
  });
  var domainField = el('label', { class: 'ed-field' }, [
    el('span', { text: 'Domain' }),
    (function () {
      var sel = el('select', {
        onchange: function () { if (sel.value) work.domain = sel.value; else delete work.domain; },
      }, [el('option', { value: '', text: 'Pick a domain (helps people find it)' })]);
      domains.forEach(function (d) { sel.appendChild(el('option', { value: d.slug, text: d.name })); });
      return sel;
    })(),
  ]);
  var kindSel = el('select', {
    onchange: function () {
      work.kind = kindSel.value;
      // Domain groups the products listing; only products need it.
      domainField.hidden = kindSel.value !== 'product';
      if (kindSel.value !== 'product') delete work.domain;
      renderBar();
    },
  }, [
    el('option', { value: 'product', text: 'Product (a finished thing)' }),
    el('option', { value: 'assembly', text: 'Assembly (a sub-unit of something)' }),
    el('option', { value: 'part', text: 'Part (a single component)' }),
  ]);
  var summaryInput = el('input', {
    type: 'text', placeholder: 'One-line summary of what it is', maxlength: '400',
    oninput: function () { if (summaryInput.value.trim()) work.summary = summaryInput.value.trim(); else delete work.summary; },
  });
  var articleBox = el('textarea', {
    class: 'ed-article', rows: '8',
    placeholder: 'Optional: describe it in markdown. Link parts with [[part-id]].',
    oninput: function () { if (articleBox.value.trim()) work.article = articleBox.value; else delete work.article; },
  });

  mount.appendChild(el('section', { class: 'editor' }, [
    el('label', { class: 'ed-field' }, [el('span', { text: 'Name' }), nameInput]),
    slugNote,
    existsNote,
    el('label', { class: 'ed-field' }, [el('span', { text: 'What is it?' }), kindSel]),
    domainField,
    el('label', { class: 'ed-field' }, [el('span', { text: 'Summary' }), summaryInput]),
    el('p', { class: 'ed-sub', text: 'Description (optional, markdown)' }),
    articleBox,
    el('p', { class: 'ed-sub', text: 'Bill of materials — the parts it is built from' }),
    rowsEl,
    picker(),
    barEl,
  ]));
  updateSlug();
  renderBar();
})();
