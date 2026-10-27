// p5.js view of the memory. Words drift to new positions when the memory
// is rearranged, fade as they age, and carry faint "ghosts" of the words
// they replaced. Hovering a ghosted word shows the ghost plainly.

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let words = [];    // currently shown
  let leaving = [];  // removed words dissolving
  let colors = {};
  let fontSize = 30;
  let pendingResize = true;

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    colors = {
      paper: s.getPropertyValue('--paper').trim(),
      ink: s.getPropertyValue('--ink').trim(),
      muted: s.getPropertyValue('--muted').trim(),
      accent: s.getPropertyValue('--accent').trim()
    };
  }

  const sketch = (p) => {
    const holder = document.getElementById('canvas-holder');
    let serif;
    let ready = false;
    let queued = null;

    function width() { return holder.clientWidth || 600; }

    function layout() {
      const w = width();
      fontSize = w < 420 ? 21 : w < 600 ? 25 : 30;
      const lineH = fontSize * 1.6;
      const space = fontSize * 0.34;
      const maxW = w - 8;
      p.textSize(fontSize);
      p.textFont(serif);

      const lines = [[]];
      let lineW = 0;
      for (const wd of words) {
        wd.width = p.textWidth(wd.w);
        const add = (lines[lines.length - 1].length ? space : 0) + wd.width;
        if (lineW + add > maxW && lines[lines.length - 1].length) {
          lines.push([]);
          lineW = 0;
        }
        lines[lines.length - 1].push(wd);
        lineW += (lines[lines.length - 1].length > 1 ? space : 0) + wd.width;
      }

      const top = fontSize * 1.2;
      lines.forEach((line, li) => {
        const total = line.reduce((s, wd, i) => s + wd.width + (i ? space : 0), 0);
        let x = (w - total) / 2;
        for (const wd of line) {
          wd.tx = x + wd.width / 2;
          wd.ty = top + li * lineH;
          x += wd.width + space;
        }
      });

      const h = Math.max(200, top + lines.length * lineH + fontSize * 0.4);
      if (p.width !== w || p.height !== h) p.resizeCanvas(w, h);
    }

    p.setup = () => {
      // p5 quotes any font string containing spaces, so pass a space-free
      // fallback list to keep it a valid CSS font stack.
      serif = 'Palatino,Georgia,Charter,serif';
      readColors();
      const c = p.createCanvas(width(), 220);
      c.parent(holder);
      p.textAlign(p.CENTER, p.BASELINE);
      p.frameRate(30);
      p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
      ready = true;
      if (queued) { window.MemoryView.set(queued.words, queued.opts); queued = null; }
      window.dispatchEvent(new Event('memoryview-ready'));
    };

    p.windowResized = () => { pendingResize = true; };

    p.draw = () => {
      if (pendingResize) { layout(); pendingResize = false; snapIfNeeded(); }
      p.background(colors.paper);
      p.textFont(serif);
      const t = p.millis() / 1000;
      let hovered = null;

      for (let i = 0; i < words.length; i++) {
        const wd = words[i];
        const k = reduceMotion ? 1 : 0.08;
        wd.x += (wd.tx - wd.x) * k;
        wd.y += (wd.ty - wd.y) * k;
        wd.appear = Math.min(1, wd.appear + (reduceMotion ? 1 : 0.03));

        // ghost: the word this one overwrote or absorbed
        if (wd.ghost) {
          const wob = reduceMotion ? 0 : Math.sin(t * 0.9 + i) * 2.5;
          p.textSize(fontSize * 0.92);
          p.fill(withAlpha(colors.muted, 0.28 * wd.appear));
          p.text(wd.ghost, wd.x + wob, wd.y - fontSize * 0.18);
        }

        // the readable word; older words fade
        const alpha = (1 - 0.62 * wd.fade) * wd.appear;
        p.textSize(fontSize);
        p.textStyle(wd.echoes >= 2 ? p.BOLD : p.NORMAL);
        p.fill(withAlpha(wd.mine && wd.highlightUntil > p.millis() ? colors.accent : colors.ink, alpha));
        p.text(wd.w, wd.x, wd.y);
        p.textStyle(p.NORMAL);

        if (wd.mine && wd.highlightUntil > p.millis()) {
          p.stroke(withAlpha(colors.accent, 0.7));
          p.strokeWeight(1);
          p.line(wd.x - wd.width / 2, wd.y + 5, wd.x + wd.width / 2, wd.y + 5);
          p.noStroke();
        }

        if (wd.ghost && Math.abs(p.mouseX - wd.x) < wd.width / 2 + 4 &&
            p.mouseY < wd.y + 6 && p.mouseY > wd.y - fontSize) {
          hovered = wd;
        }
      }

      // words that were erased or forgotten sink and dissolve
      leaving = leaving.filter((wd) => wd.life > 0);
      for (const wd of leaving) {
        wd.life -= reduceMotion ? 1 : 0.025;
        wd.y += 0.6;
        p.textSize(fontSize);
        p.fill(withAlpha(colors.accent, Math.max(0, wd.life) * 0.8));
        p.text(wd.w, wd.x, wd.y);
      }

      if (hovered) {
        p.textSize(13);
        p.fill(colors.accent);
        p.text('was: ' + hovered.ghost, hovered.x, hovered.y + 22);
        p.cursor('help');
      } else {
        p.cursor('default');
      }
    };

    function snapIfNeeded() {
      for (const wd of words) {
        if (wd.x === null) { wd.x = wd.tx; wd.y = wd.ty + 10; }
      }
    }

    // Public: replace the memory with a new version, matching words so
    // they drift rather than jump.
    window.MemoryView = {
      ready: () => ready,
      set(next, opts = {}) {
        if (!ready) { queued = { words: next, opts }; return; }
        const highlight = !!opts.highlight;
        const prev = words.slice();
        const used = new Set();
        words = next.map((n) => {
          const match = prev.find((o, idx) => !used.has(idx) && o.w === n.w && (used.add(idx), true));
          return {
            w: n.w,
            ghost: n.ghost,
            fade: n.fade,
            echoes: n.echoes,
            mine: !!n.mine,
            highlightUntil: highlight && n.mine ? p.millis() + 9000 : 0,
            x: match ? match.x : null,
            y: match ? match.y : null,
            appear: match ? 1 : 0,
            tx: 0, ty: 0, width: 0
          };
        });
        prev.forEach((o, idx) => {
          if (!used.has(idx) && o.x !== null) leaving.push({ w: o.w, x: o.x, y: o.y, life: 1 });
        });
        layout();
        snapIfNeeded();
      }
    };
  };

  function withAlpha(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  new p5(sketch);
})();
