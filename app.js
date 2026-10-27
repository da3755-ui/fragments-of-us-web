(function () {
  const $ = (id) => document.getElementById(id);
  const loadedAt = Date.now();
  let version = -1;
  let lastText = '';

  // ---- showing the memory --------------------------------------------------
  function show(memory, opts) {
    version = memory.version;
    lastText = memory.text;
    $('plain').textContent = memory.text;
    $('count').textContent = `${memory.contributions} ${memory.contributions === 1 ? 'contribution' : 'contributions'} · reconstructed, not preserved`;
    pendingView = [memory.words, opts];
    if (window.MemoryView) { window.MemoryView.set(memory.words, opts); pendingView = null; }
  }
  let pendingView = null;
  window.addEventListener('memoryview-ready', () => {
    if (pendingView && window.MemoryView) { window.MemoryView.set(...pendingView); pendingView = null; }
  });

  async function poll() {
    try {
      const r = await fetch(`/api/memory?since=${version}`, { cache: 'no-store' });
      const data = await r.json();
      if (!data.unchanged) show(data);
    } catch (_) { /* offline: try again next time */ }
  }
  poll();
  setInterval(() => { if (!document.hidden) poll(); }, 12000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  $('toggle-plain').addEventListener('click', (e) => {
    const on = document.body.classList.toggle('plain-mode');
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'show the drifting version' : 'read plainly';
  });

  // ---- contributing --------------------------------------------------------
  const msg = $('message');
  const consent = $('consent');
  const submit = $('submit');
  const status = $('form-status');

  function refresh() {
    $('chars').textContent = `${msg.value.length} / 140`;
    submit.disabled = !(consent.checked && msg.value.trim().length >= 3);
  }
  msg.addEventListener('input', refresh);
  consent.addEventListener('change', refresh);
  msg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!submit.disabled) $('form').requestSubmit(); }
  });

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    status.textContent = 'checking…';
    try {
      const r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: msg.value,
          consent: consent.checked,
          website: $('website').value,
          elapsed: Date.now() - loadedAt
        })
      });
      const data = await r.json();
      if (!data.ok) { status.textContent = data.error || 'Something went wrong.'; refresh(); return; }

      status.textContent = '';
      show(data.memory, { highlight: true });
      renderLog(data.log);
      $('token').textContent = data.token;
      $('keep-token').disabled = false;
      $('keep-token').textContent = 'keep on this device';
      $('form').hidden = true;
      $('result').hidden = false;
      msg.value = '';
      consent.checked = false;
      refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {
      status.textContent = 'Could not reach the memory. Try again.';
      refresh();
    }
  });

  // Turn the server's rule log into plain sentences.
  function renderLog(log) {
    const ul = $('log');
    ul.textContent = '';
    const say = (parts) => {
      const li = document.createElement('li');
      for (const part of parts) {
        if (typeof part === 'string') li.append(part);
        else { const em = document.createElement('em'); em.textContent = part.w; li.append(em); }
      }
      ul.append(li);
    };
    const w = (x) => ({ w: x });
    for (const step of log) {
      if (step.rule === 'echo') say(['your words echoed something the memory already held, so that sentence grew stronger.']);
      if (step.rule === 'enter') say(['your words entered as a sentence of their own.']);
      if (step.rule === 'join') say(['your words were joined to another sentence with ', w(step.link), '.']);
      if (step.rule === 'overwrite') say(['your words overwrote part of an older sentence, which lingers faintly.']);
      if (step.rule === 'swap') say(['your subject, ', w(step.gave), ', was given to another sentence.']);
      if (step.rule === 'exchange') say(['your ', w(step.gave), ' moved into another sentence.']);
      if (step.rule === 'forget') say([`to make room, the memory forgot ${step.count === 1 ? 'a phrase' : step.count + ' phrases'}.`]);
    }
    say(['then the whole memory was retold in its own words. The highlighted words came from you.']);
  }

  $('copy-token').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('token').textContent);
      $('copy-token').textContent = 'copied';
    } catch (_) {
      $('copy-token').textContent = 'select and copy it';
    }
    setTimeout(() => { $('copy-token').textContent = 'copy'; }, 2000);
  });

  // ---- optional local token storage (this browser only) -------------------
  const KEY = 'cm-tokens';
  function savedTokens() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; }
  }
  function writeTokens(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (_) { return false; }
  }
  $('keep-token').addEventListener('click', () => {
    const list = savedTokens();
    const tok = $('token').textContent;
    if (!list.includes(tok)) list.push(tok);
    $('keep-token').textContent = writeTokens(list) ? 'kept in this browser' : 'this browser will not store it';
    $('keep-token').disabled = true;
  });

  $('again').addEventListener('click', () => {
    $('result').hidden = true;
    $('form').hidden = false;
    $('token').textContent = '';
    msg.focus();
  });

  // ---- erase my trace -----------------------------------------------------
  const dialog = $('erase');
  $('open-erase').addEventListener('click', () => {
    $('erase-status').textContent = '';
    $('erase-result').hidden = true;
    renderSaved();
    dialog.showModal();
    $('erase-token').focus();
  });

  function renderSaved() {
    const box = $('saved-tokens');
    box.textContent = '';
    const list = savedTokens();
    if (!list.length) return;
    box.append('kept in this browser: ');
    list.forEach((tok, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost-btn';
      b.textContent = `trace ${i + 1}`;
      b.addEventListener('click', () => { $('erase-token').value = tok; });
      box.append(b);
    });
  }

  $('erase-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('erase-token').value.trim();
    if (!token) return;
    $('erase-status').textContent = 'erasing…';
    try {
      const r = await fetch('/api/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await r.json();
      if (!data.ok) { $('erase-status').textContent = data.error; return; }
      writeTokens(savedTokens().filter((t) => t !== token));
      renderSaved();
      $('erase-status').textContent = 'Your trace is gone. The memory has rebuilt itself without it.';
      $('erase-token').value = '';
      renderDiff(data.before, data.memory.text);
      $('erase-result').hidden = false;
      show(data.memory);
    } catch (_) {
      $('erase-status').textContent = 'Could not reach the memory. Try again.';
    }
  });

  // Show before/after, striking through words that are no longer present.
  function renderDiff(before, after) {
    const afterCounts = {};
    const key = (w) => w.toLowerCase().replace(/[.,]/g, '');
    after.split(' ').forEach((w) => { afterCounts[key(w)] = (afterCounts[key(w)] || 0) + 1; });
    const b = $('erase-before');
    b.textContent = '';
    before.split(' ').forEach((w, i) => {
      if (i) b.append(' ');
      if (afterCounts[key(w)]) { afterCounts[key(w)]--; b.append(w); }
      else { const d = document.createElement('del'); d.textContent = w; b.append(d); }
    });
    $('erase-after').textContent = after;
  }
})();
