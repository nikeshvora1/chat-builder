// Renders a chat into the phone mockup, either instantly (preview) or as a timed animation (play).
window.ChatPlayer = (() => {
  const NAME_COLORS = {
    dark: ['#53bdeb', '#fc9775', '#ffd279', '#a5b337', '#ff72a1', '#06cf9c', '#d88deb', '#7f66ff'],
    light: ['#1f7aec', '#d6612b', '#b38900', '#5e8a00', '#d63c79', '#008069', '#a24cc2', '#5b46d6'],
  };
  const AVATAR_COLORS = ['#3f8ae0', '#e3725b', '#d4a227', '#6b9f2a', '#d14c86', '#14a37f', '#9c5fc4', '#6656d8'];

  const TICKS_SVG =
    '<svg class="ticks" viewBox="0 0 16 11" data-state="sent">' +
    '<path class="t1" d="M11.1 1.2 4.9 8.8 1.6 5.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path class="t2" d="M14.9 1.2 8.7 8.8 7.6 7.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  class Cancelled extends Error {}

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function initials(name) {
    // letters/digits only, so emoji in a group name don't become broken glyphs
    const parts = String(name || '').split(/\s+/).map(w => w.match(/[\p{L}\p{N}]/gu) || []).filter(w => w.length);
    if (!parts.length) return '?';
    const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2).join('');
    return s.toUpperCase();
  }

  function isEmojiOnly(text) {
    const t = text.trim();
    if (!t || !/^[\p{Extended_Pictographic}\p{Emoji_Component}‍️\s]+$/u.test(t)) return false;
    if (/^[\d#*\s]+$/.test(t)) return false;
    const count = window.Intl && Intl.Segmenter
      ? [...new Intl.Segmenter().segment(t.replace(/\s/g, ''))].length
      : [...t.replace(/\s/g, '')].length;
    return count <= 3;
  }

  function fmtTime(mins, withAmPm) {
    mins = ((mins % 1440) + 1440) % 1440;
    const h24 = Math.floor(mins / 60), m = mins % 60;
    const h12 = h24 % 12 || 12;
    const mm = String(m).padStart(2, '0');
    return withAmPm ? `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}` : `${h12}:${mm}`;
  }

  class Player {
    constructor(phone) {
      this.phone = phone;
      this.thread = phone.querySelector('#thread');
      this.sub = phone.querySelector('#chSub');
      this.title = phone.querySelector('#chTitle');
      this.avatar = phone.querySelector('#chAvatar');
      this.sbTime = phone.querySelector('#sbTime');
      this.composer = phone.querySelector('.composer');
      this.inputText = phone.querySelector('#inputText');
      this.inputScroll = phone.querySelector('#inputScroll');
      this.sendBtn = phone.querySelector('.send-btn');
      this.token = 0;
      this.playing = false;
    }

    // ── setup ───────────────────────────────────────────
    setup(chat) {
      this.chat = chat;
      const s = chat.settings;
      this.phone.dataset.theme = s.theme;
      this.phone.dataset.wallpaper = s.wallpaper;
      this.people = new Map(chat.people.map((p, i) => [p.id, { ...p, index: i }]));
      this.isGroup = chat.type === 'group';

      this.title.textContent = chat.title || (this.isGroup ? 'Group' : 'Contact');
      if (chat.avatar) {
        this.avatar.style.backgroundImage = `url("${chat.avatar}")`;
        this.avatar.style.backgroundColor = '';
        this.avatar.textContent = '';
      } else {
        this.avatar.style.backgroundImage = '';
        this.avatar.style.backgroundColor = this.isGroup ? '#8e8e93' : this.avatarColor(chat.people[0]);
        this.avatar.textContent = initials(chat.title);
      }
      this.defaultSub = this.isGroup
        ? [...chat.people.map(p => p.name), 'You'].join(', ')
        : 'online';
      this.setSub(this.defaultSub, false);

      this.clock = this.parseStart(s.startTime);
      this.msgCount = 0;
      this.sbTime.textContent = fmtTime(this.clock, false);
      this.thread.innerHTML = '';
      this.last = null; // { from, row } for run grouping
      this.pendingRead = [];
      this.setComposer('', false);
      this.addChip('Today');
    }

    parseStart(v) {
      const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
      return m ? +m[1] * 60 + +m[2] : 10 * 60 + 30;
    }

    nameColor(p) {
      const pal = NAME_COLORS[this.chat.settings.theme] || NAME_COLORS.dark;
      return pal[(p.color ?? p.index ?? 0) % pal.length];
    }
    avatarColor(p) {
      return AVATAR_COLORS[((p && (p.color ?? p.index)) || 0) % AVATAR_COLORS.length];
    }

    setSub(text, animate = true) {
      if (this.sub.textContent === text) return;
      this.sub.textContent = text;
      if (animate) this.sub.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
    }

    setComposer(text, focused) {
      this.inputText.textContent = text;
      this.composer.classList.toggle('has-text', !!text);
      this.composer.classList.toggle('focused', !!focused);
      this.inputScroll.scrollLeft = this.inputScroll.scrollWidth;
    }

    // ── DOM builders ────────────────────────────────────
    addChip(text) {
      const row = document.createElement('div');
      row.className = 'row chip-row';
      row.innerHTML = '<span class="chip"></span>';
      row.firstChild.textContent = text;
      this.thread.appendChild(row);
      this.last = null;
      return row;
    }

    makeRow(from) {
      const out = from === 'me';
      const row = document.createElement('div');
      const newRun = !this.last || this.last.from !== from;
      row.className = `row ${out ? 'out' : 'in'} run-end${newRun ? ' run-start' : ''}`;
      if (!newRun) this.last.row.classList.remove('run-end');
      const inner = document.createElement('div');
      inner.className = 'row-inner';
      if (this.isGroup && !out) {
        const p = this.people.get(from) || {};
        const av = document.createElement('div');
        av.className = 'av';
        av.style.background = this.avatarColor(p);
        av.textContent = initials(p.name);
        inner.appendChild(av);
      }
      row.appendChild(inner);
      this.thread.appendChild(row);
      this.last = { from, row };
      return row;
    }

    makeBubble(item, row, time) {
      const out = item.from === 'me';
      const b = document.createElement('div');
      b.className = 'bubble';
      const emoji = isEmojiOnly(item.text);
      if (emoji) b.classList.add('emoji-only');
      if (this.isGroup && !out && row.classList.contains('run-start') && !emoji) {
        const p = this.people.get(item.from) || { name: '?' };
        const n = document.createElement('span');
        n.className = 'name';
        n.style.setProperty('--nc', this.nameColor(p));
        n.textContent = p.name;
        b.appendChild(n);
      }
      b.appendChild(document.createTextNode(emoji ? item.text.trim() : item.text));
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = fmtTime(time, true);
      if (out) meta.insertAdjacentHTML('beforeend', TICKS_SVG);
      // An invisible copy of the timestamp reserves room on the last line so text never runs under it
      if (!emoji) {
        const spacer = meta.cloneNode(true);
        spacer.className = 'spacer';
        b.appendChild(spacer);
      }
      b.appendChild(meta);
      return b;
    }

    typingBubble() {
      const b = document.createElement('div');
      b.className = 'bubble';
      b.innerHTML = '<div class="typing"><i></i><i></i><i></i></div>';
      return b;
    }

    nextTime() {
      // Clock creeps forward a minute every few messages so timestamps look natural.
      const t = this.clock + Math.floor(this.msgCount / 3);
      this.msgCount++;
      this.sbTime.textContent = fmtTime(t, false);
      return t;
    }

    // ── animation helpers ───────────────────────────────
    growIn(row, fromHeight = 0) {
      const cs = getComputedStyle(row);
      const to = row.offsetHeight;
      const kf = fromHeight
        ? [{ height: fromHeight + 'px' }, { height: to + 'px' }]
        : [
            { height: '0px', paddingTop: '0px', paddingBottom: '0px' },
            { height: to + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
          ];
      row.animate(kf, { duration: 300, easing: 'cubic-bezier(.25,.85,.3,1)' });
    }

    popIn(bubble, soft = false) {
      bubble.animate(
        soft
          ? [{ transform: 'scale(.92)', opacity: 0.4 }, { transform: 'none', opacity: 1 }]
          : [
              { transform: 'scale(.4) translateY(16px)', opacity: 0 },
              { transform: 'scale(1.03)', opacity: 1, offset: 0.65 },
              { transform: 'none', opacity: 1 },
            ],
        { duration: soft ? 220 : 380, easing: 'cubic-bezier(.2,.9,.3,1)' }
      );
    }

    wait(ms) {
      const tok = this.token;
      return new Promise((res, rej) =>
        setTimeout(() => (tok === this.token ? res() : rej(new Cancelled())), Math.max(0, ms))
      );
    }

    setTicks(row, state) {
      const t = row && row.querySelector('.meta .ticks');
      if (!t) return;
      if (state === 'read' && !this.chat.settings.receipts) state = 'delivered';
      t.dataset.state = state;
    }

    markAllRead() {
      this.pendingRead.forEach(r => this.setTicks(r, 'read'));
      this.pendingRead = [];
    }

    // ── public: instant render ──────────────────────────
    render(chat) {
      this.stop();
      this.setup(chat);
      for (const item of chat.items) {
        if (item.kind !== 'msg' || !item.text.trim()) continue;
        const row = this.makeRow(item.from);
        row.firstChild.appendChild(this.makeBubble(item, row, this.nextTime()));
        if (item.from === 'me') this.setTicks(row, 'read');
      }
    }

    stop() {
      this.token++;
      this.playing = false;
      // cancel scripted (WAAPI) animations only; CSS ones like the caret blink must keep running
      this.phone.getAnimations({ subtree: true })
        .filter(a => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))
        .forEach(a => a.cancel());
    }

    // ── public: animated playback ───────────────────────
    async play(chat) {
      this.stop();
      const tok = this.token;
      this.setup(chat);
      this.playing = true;
      const s = chat.settings;
      const sp = s.speed || 1;
      ChatSounds.setEnabled(!!s.sounds);
      try {
        await this.wait(700 / sp);
        const items = chat.items.filter(i => i.kind === 'pause' || i.text.trim());
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'pause') { await this.wait((item.seconds * 1000) / sp); continue; }
          if (item.from === 'me') await this.playOutgoing(item, s, sp);
          else await this.playIncoming(item, s, sp);
          const next = items[i + 1];
          const sameSender = next && next.from === item.from;
          await this.wait((sameSender ? 450 : 650) / sp);
        }
        await this.wait(1600);
      } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
        return false;
      } finally {
        if (tok === this.token) this.playing = false;
      }
      return true;
    }

    async playOutgoing(item, s, sp) {
      if (s.typeOut) {
        this.composer.classList.add('focused', 'typing-active');
        const text = item.text.replace(/\n/g, ' ');
        const chars = [...text];
        const total = clamp(chars.length * 55, 350, 2400) / sp;
        const step = Math.max(1, Math.ceil(chars.length / (total / 40)));
        const per = total / Math.ceil(chars.length / step);
        await this.wait(250 / sp);
        for (let i = step; i < chars.length + step; i += step) {
          this.setComposer(chars.slice(0, i).join(''), true);
          await this.wait(per);
        }
        this.composer.classList.remove('typing-active');
        await this.wait(260 / sp);
        this.sendBtn.classList.add('pressed');
        await this.wait(110);
        this.sendBtn.classList.remove('pressed');
        this.setComposer('', true);
      } else {
        await this.wait(200 / sp);
      }

      const row = this.makeRow('me');
      const bubble = this.makeBubble(item, row, this.nextTime());
      row.firstChild.appendChild(bubble);
      this.growIn(row);
      this.popIn(bubble);
      ChatSounds.send();

      // sent → delivered → read (read lands when the other side replies, or shortly after)
      const tok = this.token;
      setTimeout(() => tok === this.token && this.setTicks(row, 'delivered'), 450 / sp);
      this.pendingRead.push(row);
      setTimeout(() => {
        if (tok !== this.token || !this.pendingRead.includes(row)) return;
        this.markAllRead();
      }, 1300 / sp);
    }

    async playIncoming(item, s, sp) {
      if (this.composer.classList.contains('focused')) this.setComposer('', false);
      this.markAllRead();
      const p = this.people.get(item.from) || { name: '?' };
      let row, typing;
      if (s.typing) {
        await this.wait(200 / sp);
        this.setSub(this.isGroup ? `${p.name} is typing…` : 'typing…');
        row = this.makeRow(item.from);
        typing = this.typingBubble();
        row.firstChild.appendChild(typing);
        this.growIn(row);
        this.popIn(typing);
        const dur = clamp(700 + item.text.length * 38, 1100, 3400) / sp;
        await this.wait(dur);
      } else {
        await this.wait(300 / sp);
        row = this.makeRow(item.from);
      }

      const bubble = this.makeBubble(item, row, this.nextTime());
      if (typing) {
        const before = row.offsetHeight;
        typing.replaceWith(bubble);
        this.growIn(row, before);
        this.popIn(bubble, true);
        this.setSub(this.defaultSub);
      } else {
        row.firstChild.appendChild(bubble);
        this.growIn(row);
        this.popIn(bubble);
      }
      ChatSounds.receive();
    }
  }

  return { Player, initials, NAME_COLORS, AVATAR_COLORS };
})();
