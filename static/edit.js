// The in-place editor island. Reads the node snapshot embedded by the
// server, turns the page into a form on demand, shows a running
// plain-language change list, and proposes a changeset via the API.
(function () {
  'use strict';

  var dataEl = document.getElementById('bw-edit-data');
  var editBtn = document.getElementById('bw-edit-btn');
  if (!dataEl || !editBtn) return;

  var embedded = JSON.parse(dataEl.textContent);
  var nodeId = embedded.id;
  var baseRev = embedded.rev;
  var orig = embedded.data;
  var names = embedded.names || {}; // { childId: displayName }, from the server
  var work = null;
  var creates = [];
  var editorEl = null;

  fetch('/api/session')
    .then(function (r) { return r.json(); })
    .then(function (s) {
      if (s.handle) editBtn.hidden = false;
      var vf = document.getElementById('bw-verify-form');
      if (vf && (s.role === 'admin' || s.role === 'reviewer')) vf.hidden = false;
    });

  // Surface in-flight proposals on the page itself, so a contributor who
  // just proposed (or anyone else) can find them. The page HTML is cached
  // and session-agnostic, so this has to come from a live endpoint.
  fetch('/api/pending?node=' + encodeURIComponent(nodeId))
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var list = (j && j.pending) || [];
      if (!list.length) return;
      var note = el('p', { class: 'pending-note' });
      note.appendChild(document.createTextNode(
        list.length === 1 ? '1 proposed change is awaiting review: ' : list.length + ' proposed changes are awaiting review: '));
      list.forEach(function (p, i) {
        if (i) note.appendChild(document.createTextNode(', '));
        note.appendChild(el('a', { href: '/changeset/' + p.id, text: '#' + p.id + ' by ' + p.author }));
      });
      note.appendChild(document.createTextNode('.'));
      document.querySelector('.wtitle').after(note);
    })
    .catch(function () {});

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

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

  function nameOf(id) {
    for (var i = 0; i < creates.length; i++) if (creates[i].id === id) return creates[i].name;
    return names[id] || id;
  }

  function words(s) { return (s.match(/\b\w+\b/g) || []).length; }

  function diffLines() {
    var lines = [];
    ['summary', 'material', 'standard'].forEach(function (f) {
      var a = orig[f] || '';
      var b = work[f] || '';
      if (a !== b) lines.push(b ? f + ' changed to "' + b + '"' : f + ' removed');
    });
    if ((orig.aliases || []).join('|') !== (work.aliases || []).join('|')) {
      lines.push((work.aliases || []).length ? 'Aliases changed to "' + work.aliases.join(', ') + '"' : 'Aliases removed');
    }
    if ((orig.article || '') !== (work.article || '')) {
      var d = words(work.article || '') - words(orig.article || '');
      lines.push(work.article ? 'Article updated (' + (d > 0 ? '+' : '') + d + ' words)' : 'Article removed');
    }
    var origSpecs = {};
    (orig.specs || []).forEach(function (s) { origSpecs[s[0]] = s[1]; });
    var workKeys = {};
    (work.specs || []).forEach(function (s) {
      workKeys[s[0]] = true;
      if (!(s[0] in origSpecs)) lines.push('Spec ' + s[0] + ' added: "' + s[1] + '"');
      else if (origSpecs[s[0]] !== s[1]) lines.push('Spec ' + s[0] + ' changed to "' + s[1] + '"');
    });
    (orig.specs || []).forEach(function (s) {
      if (!workKeys[s[0]]) lines.push('Spec ' + s[0] + ' removed');
    });
    var baseMap = {};
    (orig.bom || []).forEach(function (l) { baseMap[l.id] = l; });
    var nextIds = {};
    (work.bom || []).forEach(function (l) {
      nextIds[l.id] = true;
      var b = baseMap[l.id];
      if (!b) lines.push('Added ' + nameOf(l.id) + ' × ' + l.qty);
      else {
        if (b.qty !== l.qty) lines.push(nameOf(l.id) + ' quantity ' + b.qty + ' → ' + l.qty);
        if ((b.note || '') !== (l.note || '')) lines.push(nameOf(l.id) + ' note updated');
      }
    });
    (orig.bom || []).forEach(function (l) {
      if (!nextIds[l.id]) lines.push('Removed ' + nameOf(l.id));
    });
    return lines;
  }

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function renderChangeBar() {
    var bar = editorEl.querySelector('.ed-bar');
    bar.innerHTML = '';
    var lines = diffLines();
    if (!lines.length) {
      bar.appendChild(el('p', { class: 'ed-bar-empty', text: 'No changes yet.' }));
      return;
    }
    var list = el('ul', { class: 'ed-lines' });
    lines.forEach(function (l) { list.appendChild(el('li', { text: l })); });
    bar.appendChild(el('p', { class: 'ed-bar-h', text: 'Your proposed changes' }));
    bar.appendChild(list);
    bar.appendChild(
      el('div', { class: 'ed-bar-actions' }, [
        el('button', {
          type: 'button',
          class: 'ed-propose',
          text: 'Propose ' + lines.length + ' change' + (lines.length > 1 ? 's' : ''),
          onclick: propose,
        }),
        el('span', { class: 'ed-hint', text: 'Goes to review, then live' }),
      ]),
    );
  }

  function bomRow(line) {
    var qty = el('input', {
      type: 'number', min: '1', step: '1', value: String(line.qty),
      oninput: function () { line.qty = Math.max(1, Math.round(Number(qty.value) || 1)); renderChangeBar(); },
    });
    var note = el('input', {
      type: 'text', value: line.note || '', placeholder: 'Note',
      oninput: function () { if (note.value.trim()) line.note = note.value.trim(); else delete line.note; renderChangeBar(); },
    });
    var row = el('div', { class: 'ed-row', 'data-id': line.id }, [
      el('span', { class: 'ed-name', text: nameOf(line.id) || line.id }),
      qty,
      note,
      el('button', {
        type: 'button', class: 'ed-del', 'aria-label': 'Remove ' + line.id, text: '×',
        onclick: function () {
          work.bom = (work.bom || []).filter(function (l) { return l !== line; });
          creates = creates.filter(function (c) { return c.id !== line.id; });
          row.remove();
          renderChangeBar();
        },
      }),
    ]);
    return row;
  }

  function picker() {
    var input = el('input', { type: 'text', class: 'ed-pick', placeholder: 'Add a component by name…' });
    var list = el('div', { class: 'ed-pick-list' });
    var timer = null;

    function addLine(id, name) {
      work.bom = work.bom || [];
      if (work.bom.some(function (l) { return l.id === id; })) return;
      var line = { id: id, qty: 1 };
      work.bom.push(line);
      var rows = editorEl.querySelector('.ed-rows');
      rows.appendChild(bomRow(line));
      rows.lastChild.querySelector('.ed-name').textContent = name;
      input.value = '';
      list.innerHTML = '';
      renderChangeBar();
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
            // Server requires ids of 2+ chars (ID_RE); don't offer create for
            // names that would slug shorter, or the propose would 422.
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

  function textField(label, field) {
    var input = el('input', {
      type: 'text', value: work[field] || '', placeholder: label,
      oninput: function () { if (input.value.trim()) work[field] = input.value.trim(); else delete work[field]; renderChangeBar(); },
    });
    return el('label', { class: 'ed-field' }, [el('span', { text: label }), input]);
  }

  function propose() {
    var edits = creates.map(function (c) {
      return { op: 'create', nodeId: c.id, data: { name: c.name, kind: c.kind } };
    });
    edits.push({ op: 'edit', nodeId: nodeId, baseRev: baseRev, data: work });
    fetch('/api/changesets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ edits: edits }),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (r) {
        var bar = editorEl.querySelector('.ed-bar');
        if (r.status === 201) {
          if (r.body.applied) { window.location.reload(); return; }
          exitEdit();
          var ok = el('p', { class: 'ed-done' });
          ok.appendChild(document.createTextNode('Change #' + r.body.id + ' submitted. A reviewer will check it before it goes live. '));
          ok.appendChild(el('a', { href: '/changeset/' + r.body.id, text: 'Track it here' }));
          ok.appendChild(document.createTextNode('.'));
          document.querySelector('.wtitle').after(ok);
        } else {
          bar.insertBefore(
            el('p', { class: 'ed-errors', text: (r.body.errors || [r.body.error || 'failed']).join('; ') }),
            bar.firstChild,
          );
        }
      });
  }

  function enterEdit() {
    work = clone(orig);
    creates = [];
    var pane = document.querySelector('.pane');
    var bom = pane.querySelector('.bom');
    var article = pane.querySelector('.article');
    if (article) article.hidden = true;
    if (bom) bom.hidden = true;
    editBtn.textContent = 'Cancel';

    var rows = el('div', { class: 'ed-rows' });
    (work.bom || []).forEach(function (l) { rows.appendChild(bomRow(l)); });

    var articleBox = el('textarea', {
      class: 'ed-article', rows: '14',
      placeholder: 'Write the article in markdown. Link parts with [[part-id]] or [[part-id|Label]].',
      oninput: function () {
        if (articleBox.value.trim()) work.article = articleBox.value;
        else delete work.article;
        renderChangeBar();
      },
    });
    articleBox.value = work.article || '';

    var specRows = el('div', { class: 'ed-rows' });
    function specRow(pair) {
      var val = el('input', {
        type: 'text', value: pair[1],
        oninput: function () { pair[1] = val.value; renderChangeBar(); },
      });
      var row = el('div', { class: 'ed-spec-row' }, [
        el('span', { class: 'ed-name', text: pair[0] }),
        val,
        el('button', {
          type: 'button', class: 'ed-del', 'aria-label': 'Remove spec ' + pair[0], text: '×',
          onclick: function () {
            work.specs = (work.specs || []).filter(function (p) { return p !== pair; });
            row.remove();
            renderChangeBar();
          },
        }),
      ]);
      return row;
    }
    (work.specs || []).forEach(function (p) { specRows.appendChild(specRow(p)); });
    var newSpecKey = el('input', { type: 'text', placeholder: 'New spec name (e.g. Voltage)' });
    var newSpecVal = el('input', { type: 'text', placeholder: 'Value' });
    var addSpec = el('div', { class: 'ed-spec-row ed-spec-add' }, [
      newSpecKey,
      newSpecVal,
      el('button', {
        type: 'button', class: 'ed-del', 'aria-label': 'Add spec', text: '+',
        onclick: function () {
          var k = newSpecKey.value.trim();
          if (!k || !newSpecVal.value.trim()) return;
          if ((work.specs || []).some(function (p) { return p[0] === k; })) return;
          var pair = [k, newSpecVal.value.trim()];
          work.specs = work.specs || [];
          work.specs.push(pair);
          specRows.appendChild(specRow(pair));
          newSpecKey.value = '';
          newSpecVal.value = '';
          renderChangeBar();
        },
      }),
    ]);

    var aliasInput = el('input', {
      type: 'text', value: (work.aliases || []).join(', '), placeholder: 'Comma-separated alternative names',
      oninput: function () {
        var list = aliasInput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (list.length) work.aliases = list; else delete work.aliases;
        renderChangeBar();
      },
    });

    editorEl = el('section', { class: 'editor' }, [
      el('p', { class: 'ed-h', text: 'Editing: fields, article, specs, and bill of materials' }),
      textField('Summary', 'summary'),
      textField('Material', 'material'),
      textField('Standard', 'standard'),
      el('label', { class: 'ed-field' }, [el('span', { text: 'Aliases' }), aliasInput]),
      el('p', { class: 'ed-sub', text: 'Article (markdown, [[part-id]] links)' }),
      articleBox,
      el('p', { class: 'ed-sub', text: 'Specs (infobox rows)' }),
      specRows,
      addSpec,
      el('p', { class: 'ed-sub', text: 'Bill of materials' }),
      rows,
      picker(),
      el('div', { class: 'ed-bar' }),
    ]);
    var anchor = bom || article;
    if (anchor) anchor.before(editorEl);
    else pane.appendChild(editorEl);
    renderChangeBar();
  }

  function exitEdit() {
    if (editorEl) editorEl.remove();
    editorEl = null;
    var pane = document.querySelector('.pane');
    var bom = pane.querySelector('.bom');
    var article = pane.querySelector('.article');
    if (article) article.hidden = false;
    if (bom) bom.hidden = false;
    editBtn.textContent = 'Edit this page';
  }

  editBtn.addEventListener('click', function () {
    if (editorEl) exitEdit();
    else enterEdit();
  });
})();
