// Editor state, live preview, present mode, recording and share links.
(() => {
  const $ = s => document.querySelector(s);
  const STORE_KEY = 'chatbuilder:v1';
  const uid = () => Math.random().toString(36).slice(2, 9);

  const DEFAULT = {
    type: 'dm',
    groupTitle: 'Weekend plans 🏕️',
    avatar: null,
    me: 'Me',
    people: [{ id: 'p1', name: 'Maya', color: 0 }],
    items: [
      ['p1', 'are you awake?? 👀'],
      ['me', 'unfortunately yes'],
      ['p1', 'ok good because I have news'],
      ['p1', 'big news'],
      ['me', 'go on…'],
      ['p1', 'I GOT THE JOB!!!'],
      ['me', 'NO WAY'],
      ['me', '🎉🎉🎉'],
      ['p1', 'drinks tomorrow, my treat 🥂'],
      ['me', 'say less'],
    ].map(([from, text]) => ({ id: uid(), kind: 'msg', from, text })),
    settings: {
      theme: 'dark', wallpaper: 'plain', startTime: '22:47', speed: 1, stageBg: 'studio', framing: 'full',
      typing: true, typeOut: true, receipts: true, sounds: true,
    },
  };

  let state = structuredClone(DEFAULT);
  let view = 'list';
  const player = new ChatPlayer.Player($('#phone'));

  // ── persistence & share links ─────────────────────────
  const b64url = {
    enc: bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
  };
  async function pipe(bytes, Stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer());
  }
  async function encodeShare(s) {
    const { avatar, ...rest } = s; // images would make the link enormous
    const bytes = new TextEncoder().encode(JSON.stringify(rest));
    if (window.CompressionStream) return 'z' + b64url.enc(await pipe(bytes, CompressionStream));
    return 'j' + b64url.enc(bytes);
  }
  async function decodeShare(str) {
    let bytes = b64url.dec(str.slice(1));
    if (str[0] === 'z') bytes = await pipe(bytes, DecompressionStream);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function sanitize(s) {
    const d = structuredClone(DEFAULT);
    const out = { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    if (!Array.isArray(out.people) || !out.people.length) out.people = d.people;
    if (!Array.isArray(out.items)) out.items = [];
    out.items.forEach(i => { i.id ||= uid(); i.kind ||= 'msg'; i.text ??= ''; });
    if (!['full', 'half'].includes(out.settings.framing)) out.settings.framing = 'full';
    return out;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  }
  async function load() {
    const m = /[#&]c=([\w-]+)/.exec(location.hash);
    if (m) {
      try {
        state = sanitize(await decodeShare(m[1]));
        history.replaceState(null, '', location.pathname + location.search);
        return;
      } catch (e) { console.warn('Bad share link', e); }
    }
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) state = sanitize(JSON.parse(raw));
    } catch {}
  }

  // ── chat model for the player ─────────────────────────
  function toChat() {
    const dm = state.type === 'dm';
    const people = dm ? [state.people[0]] : state.people;
    const ids = new Set(people.map(p => p.id));
    return {
      type: state.type,
      title: dm ? state.people[0].name : state.groupTitle,
      avatar: state.avatar,
      people,
      items: state.items
        .filter(i => i.kind === 'pause' || i.from === 'me' || ids.has(i.from) || dm)
        .map(i => (dm && i.kind === 'msg' && i.from !== 'me' ? { ...i, from: people[0].id } : i)),
      settings: state.settings,
    };
  }

  let renderTimer;
  function changed({ rebuild = false } = {}) {
    save();
    if (rebuild) renderEditor();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => player.render(toChat()), 120);
  }

  // ── script format ─────────────────────────────────────
  function nameOf(from) {
    if (from === 'me') return state.me || 'Me';
    return (state.people.find(p => p.id === from) || {}).name || '?';
  }
  function toScript() {
    return state.items
      .map(i => (i.kind === 'pause' ? `[pause ${i.seconds}]` : `${nameOf(i.from)}: ${i.text}`))
      .join('\n');
  }
  function fromScript(text) {
    const meNames = new Set(['me', 'you', (state.me || '').toLowerCase()]);
    const dm = state.type === 'dm';
    const byName = new Map(state.people.map(p => [p.name.toLowerCase(), p]));
    const used = new Map();
    const items = [];
    let dmContactNamed = false;
    for (const line of text.split('\n')) {
      const pause = /^\s*\[pause\s*([\d.]+)\s*s?\]\s*$/i.exec(line);
      if (pause) { items.push({ id: uid(), kind: 'pause', seconds: +pause[1] }); continue; }
      const m = /^([^:\n]{1,24}):\s?(.*)$/.exec(line);
      if (!m) {
        const prev = items[items.length - 1];
        if (prev && prev.kind === 'msg') prev.text += '\n' + line;
        else if (line.trim()) items.push({ id: uid(), kind: 'msg', from: 'me', text: line });
        continue;
      }
      const name = m[1].trim(), key = name.toLowerCase();
      let from;
      if (meNames.has(key)) from = 'me';
      else if (dm) {
        const contact = state.people[0];
        if (!dmContactNamed && key !== contact.name.toLowerCase() && !byName.has(key)) contact.name = name;
        dmContactNamed = true;
        from = contact.id;
        used.set(contact.id, contact);
      } else {
        let p = byName.get(key);
        if (!p) {
          p = { id: uid(), name, color: nextColor([...used.values()]) };
          byName.set(key, p);
        }
        used.set(p.id, p);
        from = p.id;
      }
      items.push({ id: uid(), kind: 'msg', from, text: m[2] });
    }
    state.items = items.map(i => ({ ...i, text: i.text?.replace(/\n+$/, '') ?? i.text }));
    if (!dm && used.size) state.people = [...used.values()];
  }
  function nextColor(people = state.people) {
    const taken = new Set(people.map(p => p.color));
    for (let c = 0; c < 8; c++) if (!taken.has(c)) return c;
    return people.length % 8;
  }

  // ── editor rendering ──────────────────────────────────
  function renderEditor() {
    const dm = state.type === 'dm';
    setSeg('#chatType', state.type);
    setSeg('#msgView', view);
    $('#titleLabel').textContent = dm ? 'Contact name' : 'Group name';
    $('#title').value = dm ? state.people[0].name : state.groupTitle;
    $('#meName').value = state.me;
    $('#peopleCard').hidden = dm;
    renderAvatarPick();
    renderPeople();
    renderMsgs();
    $('#msgListWrap').hidden = view !== 'list';
    $('#scriptWrap').hidden = view !== 'script';
    if (view === 'script' && document.activeElement !== $('#script')) $('#script').value = toScript();

    const s = state.settings;
    for (const k of ['theme', 'wallpaper', 'startTime', 'stageBg', 'framing', 'speed']) $('#' + k).value = s[k];
    for (const k of ['typing', 'typeOut', 'receipts', 'sounds']) $('#' + k).checked = !!s[k];
    $('#speedOut').textContent = `${s.speed}×`;
    $('#stage').dataset.bg = s.stageBg;
    $('#stage').dataset.framing = s.framing;
    fitPhone();
  }

  function setSeg(sel, value) {
    document.querySelectorAll(`${sel} button`).forEach(b => b.classList.toggle('on', b.dataset.value === value));
  }

  function renderAvatarPick() {
    const el = $('#avatarPick');
    if (state.avatar) {
      el.style.backgroundImage = `url("${state.avatar}")`;
      el.textContent = '';
      el.title = 'Change avatar (right-click to remove)';
    } else {
      el.style.backgroundImage = '';
      el.style.backgroundColor = state.type === 'dm' ? ChatPlayer.AVATAR_COLORS[state.people[0].color % 8] : '#8e8e93';
      el.textContent = ChatPlayer.initials(state.type === 'dm' ? state.people[0].name : state.groupTitle);
      el.title = 'Upload avatar';
    }
  }

  function renderPeople() {
    const ul = $('#people');
    ul.innerHTML = '';
    const pal = ChatPlayer.NAME_COLORS.dark;
    state.people.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = '<button class="swatch" title="Change color"></button><input type="text" maxlength="24" /><button class="x" title="Remove">×</button>';
      const [sw, input, x] = li.children;
      sw.style.background = pal[p.color % 8];
      input.value = p.name;
      sw.onclick = () => { p.color = (p.color + 1) % 8; changed({ rebuild: true }); };
      input.oninput = () => { p.name = input.value || '?'; renderMsgSenders(); changed(); };
      x.disabled = state.people.length < 2;
      x.onclick = () => {
        state.people = state.people.filter(q => q !== p);
        state.items = state.items.filter(i => i.from !== p.id);
        changed({ rebuild: true });
      };
      ul.appendChild(li);
    });
  }

  function senderOptions() {
    const ppl = state.type === 'dm' ? [state.people[0]] : state.people;
    return [...ppl.map(p => [p.id, p.name]), ['me', state.me || 'Me'], ['pause', '⏸ Pause']];
  }

  function renderMsgSenders() {
    document.querySelectorAll('#msgs select.who').forEach(sel => {
      const v = sel.value;
      sel.innerHTML = senderOptions().map(([id, n]) => `<option value="${id}">${escapeHtml(n)}</option>`).join('');
      sel.value = v;
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function renderMsgs() {
    const ol = $('#msgs');
    ol.innerHTML = '';
    const dm = state.type === 'dm';
    state.items.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = '<select class="who"></select><textarea rows="1"></textarea><button class="x" title="Delete">×</button>';
      const [sel, ta, x] = li.children;
      sel.innerHTML = senderOptions().map(([id, n]) => `<option value="${id}">${escapeHtml(n)}</option>`).join('');
      const from = item.kind === 'pause' ? 'pause' : dm && item.from !== 'me' ? state.people[0].id : item.from;
      sel.value = from;
      const paint = () => {
        const v = sel.value;
        li.className = v === 'me' ? 'me' : v === 'pause' ? 'pause' : '';
        const p = state.people.find(q => q.id === v);
        sel.style.setProperty('--who', p ? ChatPlayer.NAME_COLORS.light[p.color % 8] : '');
        ta.placeholder = v === 'pause' ? 'seconds' : 'Message';
      };
      ta.value = item.kind === 'pause' ? item.seconds : item.text;
      paint();

      sel.onchange = () => {
        if (sel.value === 'pause') {
          Object.assign(item, { kind: 'pause', seconds: parseFloat(ta.value) || 1 });
          ta.value = item.seconds;
        } else {
          if (item.kind === 'pause') { item.text = ''; ta.value = ''; }
          Object.assign(item, { kind: 'msg', from: sel.value });
        }
        paint();
        changed();
      };
      ta.oninput = () => {
        autosize(ta);
        if (item.kind === 'pause') item.seconds = parseFloat(ta.value) || 0;
        else item.text = ta.value;
        changed();
      };
      ta.onkeydown = e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          addMessageAfter(item);
        } else if (e.key === 'Backspace' && !ta.value && state.items.length > 1) {
          e.preventDefault();
          const idx = state.items.indexOf(item);
          state.items.splice(idx, 1);
          changed({ rebuild: true });
          focusMsg(state.items[Math.max(0, idx - 1)]);
        }
      };
      x.onclick = () => {
        state.items = state.items.filter(i => i !== item);
        changed({ rebuild: true });
      };
      li.dataset.id = item.id;
      ol.appendChild(li);
      requestAnimationFrame(() => autosize(ta));
    });
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
  }

  function focusMsg(item) {
    if (!item) return;
    const ta = document.querySelector(`#msgs li[data-id="${item.id}"] textarea`);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  function addMessageAfter(after) {
    const msgs = state.items.filter(i => i.kind === 'msg');
    const ref = after && after.kind === 'msg' ? after : msgs[msgs.length - 1];
    let from;
    if (!ref) from = state.people[0].id;
    else if (ref.from !== 'me') from = 'me';
    else {
      // reply from whoever spoke last (that isn't me)
      const idx = after ? state.items.indexOf(after) : state.items.length;
      const lastOther = state.items.slice(0, idx).reverse().find(i => i.kind === 'msg' && i.from !== 'me');
      from = state.type === 'dm' ? state.people[0].id : (lastOther || { from: state.people[0].id }).from;
    }
    const item = { id: uid(), kind: 'msg', from, text: '' };
    const idx = after ? state.items.indexOf(after) + 1 : state.items.length;
    state.items.splice(idx, 0, item);
    changed({ rebuild: true });
    focusMsg(item);
  }

  // ── editor events ─────────────────────────────────────
  function bindEditor() {
    document.querySelectorAll('#chatType button').forEach(b => (b.onclick = () => {
      state.type = b.dataset.value;
      if (state.type === 'group' && state.people.length < 2) {
        state.people.push({ id: uid(), name: 'Sam', color: nextColor() });
      }
      changed({ rebuild: true });
    }));
    document.querySelectorAll('#msgView button').forEach(b => (b.onclick = () => {
      view = b.dataset.value;
      renderEditor();
      if (view === 'script') $('#script').focus();
    }));
    $('#title').oninput = e => {
      if (state.type === 'dm') state.people[0].name = e.target.value || 'Contact';
      else state.groupTitle = e.target.value;
      renderAvatarPick();
      renderMsgSenders();
      changed();
    };
    $('#meName').oninput = e => { state.me = e.target.value || 'Me'; renderMsgSenders(); changed(); };
    $('#addPerson').onclick = () => {
      const names = ['Sam', 'Priya', 'Leo', 'Jordan', 'Ava', 'Kenji', 'Zoe', 'Omar'];
      const name = names.find(n => !state.people.some(p => p.name === n)) || `Person ${state.people.length + 1}`;
      state.people.push({ id: uid(), name, color: nextColor() });
      changed({ rebuild: true });
    };
    $('#addMsg').onclick = () => addMessageAfter(null);

    let scriptTimer;
    $('#script').oninput = () => {
      clearTimeout(scriptTimer);
      scriptTimer = setTimeout(() => {
        fromScript($('#script').value);
        renderPeople();
        renderMsgs();
        changed();
      }, 250);
    };

    $('#avatarPick').onclick = () => $('#avatarFile').click();
    $('#avatarPick').oncontextmenu = e => { e.preventDefault(); state.avatar = null; changed({ rebuild: true }); };
    $('#avatarFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      state.avatar = await downscale(f, 160);
      e.target.value = '';
      changed({ rebuild: true });
    };

    for (const k of ['theme', 'wallpaper', 'startTime', 'stageBg', 'framing']) {
      $('#' + k).onchange = e => { state.settings[k] = e.target.value; changed({ rebuild: true }); };
    }
    $('#speed').oninput = e => { state.settings.speed = +e.target.value; $('#speedOut').textContent = `${state.settings.speed}×`; save(); };
    for (const k of ['typing', 'typeOut', 'receipts', 'sounds']) {
      $('#' + k).onchange = e => { state.settings[k] = e.target.checked; changed(); };
    }
  }

  function downscale(file, size) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const s = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(img.src);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }

  // ── stage: fit, play, present ─────────────────────────
  const app = $('#app'), stage = $('#stage'), fit = $('#phoneFit');
  const HALF_VISIBLE = 520; // px of the phone (from its top) shown in half framing
  const VIEWPORT_BOTTOM = 768; // phone y where the chat area ends (above composer + home indicator)
  function fitPhone() {
    const r = stage.getBoundingClientRect();
    const presenting = app.classList.contains('presenting');
    const pad = presenting ? 32 : 56;
    let scale, top;
    if (state.settings.framing === 'half') {
      // Half framing: zoom in so only the top HALF_VISIBLE px of the phone fill the stage; the rest runs off the bottom
      top = pad / 2 + 8;
      scale = Math.min((r.width - pad) / 414, (r.height - top) / HALF_VISIBLE, presenting ? 3 : 1.5);
    } else {
      scale = Math.min((r.width - pad) / 414, (r.height - pad) / 868, presenting ? 3 : 1.15);
      top = 0;
    }
    scale = Math.max(scale, 0.2);
    // In half framing, lift the thread so its last message sits just above wherever the stage cuts the phone off
    // (when the stage is tall and width-limits the zoom, more than HALF_VISIBLE px of phone are on screen).
    const visible = Math.min(868, (r.height - top) / scale);
    $('#thread').style.paddingBottom =
      state.settings.framing === 'half' ? `${Math.max(10, VIEWPORT_BOTTOM - visible + 14)}px` : '';
    // scale from the top-left corner and shrink/grow the layout box to match with margins
    fit.style.transform = `scale(${scale})`;
    fit.style.margin = `${top}px ${414 * scale - 414}px ${868 * scale - 868}px 0`;
  }
  new ResizeObserver(fitPhone).observe(stage);

  async function play() {
    ChatSounds.unlock();
    $('#generate').textContent = '■ Stop';
    $('#hudPlay').textContent = '■';
    const done = await player.play(toChat());
    if (done !== false || !player.playing) resetPlayButtons();
    return done;
  }
  function stopPlay() {
    player.stop();
    resetPlayButtons();
    player.render(toChat());
  }
  function resetPlayButtons() {
    $('#generate').textContent = '▶ Generate';
    $('#hudPlay').textContent = '▶';
  }
  const togglePlay = () => (player.playing ? stopPlay() : play());

  function setPresenting(on) {
    app.classList.toggle('presenting', on);
    fitPhone();
  }

  // ── recording ─────────────────────────────────────────
  let recording = null;
  async function record() {
    if (recording) { recording.stop(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      toast('Recording needs desktop Chrome or Edge — or use Present mode with your own screen recorder');
      return;
    }
    stopPlay();
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60, displaySurface: 'browser' },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'exclude',
      });
    } catch {
      toast('Recording cancelled');
      return;
    }
    const [track] = stream.getVideoTracks();
    setPresenting(true);
    app.classList.add('recording');
    await sleep(900); // let the "sharing this tab" bar settle before cropping

    // Crop the capture to just the stage (Chrome's Region Capture)
    if (window.CropTarget && track.cropTo) {
      try { await track.cropTo(await CropTarget.fromElement(stage)); } catch (e) { console.warn('cropTo failed', e); }
    }

    for (const n of ['3', '2', '1']) {
      $('#countdown').hidden = false;
      $('#countdown').textContent = n;
      await sleep(650);
    }
    $('#countdown').hidden = true;
    await sleep(250);

    const mime = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const finished = new Promise(r => (rec.onstop = r));
    recording = rec;
    $('#record').textContent = '■ Stop rec';
    track.onended = () => rec.state !== 'inactive' && rec.stop();
    rec.start(250);

    const playing = play();
    await Promise.race([playing, finished]);
    if (rec.state !== 'inactive') rec.stop();
    await finished;
    stream.getTracks().forEach(t => t.stop());
    recording = null;
    $('#record').textContent = '● Record';
    app.classList.remove('recording');
    if (player.playing) stopPlay();

    const ext = (rec.mimeType || mime).includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: rec.mimeType || mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast(`Saved ${a.download}`);
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ── top-level actions ─────────────────────────────────
  function bindActions() {
    $('#generate').onclick = togglePlay;
    $('#hudPlay').onclick = togglePlay;
    $('#present').onclick = () => setPresenting(true);
    $('#hudExit').onclick = () => setPresenting(false);
    $('#record').onclick = record;
    $('#share').onclick = async () => {
      const url = `${location.origin}${location.pathname}#c=${await encodeShare(state)}`;
      try {
        await navigator.clipboard.writeText(url);
        toast(state.avatar ? 'Link copied (avatar image isn’t included)' : 'Link copied');
      } catch {
        prompt('Copy this link:', url);
      }
    };
    document.addEventListener('keydown', e => {
      const typingInField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
      if (e.key === 'Escape' && app.classList.contains('presenting') && !recording) setPresenting(false);
      if (e.code === 'Space' && !typingInField && !recording) { e.preventDefault(); togglePlay(); }
    });
  }

  // ── boot ──────────────────────────────────────────────
  load().then(() => {
    bindEditor();
    bindActions();
    renderEditor();
    player.render(toChat());
    fitPhone();
  });
  window.addEventListener('hashchange', () => {
    if (!/[#&]c=/.test(location.hash)) return;
    load().then(() => { save(); renderEditor(); player.render(toChat()); });
  });
})();
