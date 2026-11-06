(function () {
  "use strict";
  const { CHARACTERS, ISLANDS, LV, CHECK, FISHCOL } = window.CONTENT;
  const ORDER = ISLANDS.flatMap(i => i.levels);
  const KEY = "lanyu-voyage-v1"; // 和舊版航海圖同一個存檔，進度會接續

  let S = { name: "", cls: "", char: 0, stars: {}, check: [], intro: false };
  try { const r = localStorage.getItem(KEY); if (r) S = Object.assign(S, JSON.parse(r)); } catch (e) {}
  if (!(S.char >= 0 && S.char < CHARACTERS.length)) S.char = 0;
  if (!S.stars || typeof S.stars !== "object") S.stars = {};
  if (!Array.isArray(S.check)) S.check = [];
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const starStr = n => `<span class="stars" aria-label="${n} 顆星">${"★".repeat(n)}<span class="off">${"★".repeat(3 - n)}</span></span>`;
  const fishSVG = c => `<svg viewBox="0 0 60 30" aria-hidden="true"><path d="M6 15 Q20 4 40 12 L54 6 L50 15 L54 24 L40 18 Q20 26 6 15Z" fill="${c}" stroke="#1b2422" stroke-width="1.4"/><path d="M22 13 L32 2 L36 12Z" fill="${c}" stroke="#1b2422" stroke-width="1.2" opacity=".85"/><circle cx="12" cy="14" r="1.6" fill="#1b2422"/></svg>`;
  const unlocked = id => { const i = ORDER.indexOf(id); return i === 0 || S.stars[ORDER[i - 1]] > 0; };
  const nextId = () => ORDER.find(k => !(S.stars[k] > 0));
  const islandOf = k => ISLANDS.findIndex(i => i.levels.includes(k));
  const curIsland = () => { const n = nextId(); return n ? islandOf(n) : ISLANDS.length - 1; };
  const allDone = () => !nextId();
  const totalStars = () => ORDER.reduce((a, k) => a + (S.stars[k] || 0), 0);
  const clearedN = () => ORDER.filter(k => S.stars[k] > 0).length;
  const hero = () => CHARACTERS[S.char];

  let sel = curIsland();

  /* ---------- 3D ---------- */
  const has3D = !!(window.World && window.World.init && window.THREE && window.THREE.OrbitControls) &&
    World.init($("sea"), $("labels"), {
      onPick: i => { sel = i; render(); World.focus(i); if (window.innerWidth <= 820) $("ilist").scrollIntoView({ behavior: "smooth", block: "start" }); },
      onZoom: p => { $("zPct").textContent = p + "%"; },
      onInteract: () => $("hint").classList.add("gone")
    });
  if (!has3D) { $("nogl").hidden = false; $("zoombar").hidden = true; $("hint").hidden = true; }
  setTimeout(() => $("hint").classList.add("gone"), 9000);

  /* ---------- 側邊面板 ---------- */
  function render() {
    const ch = hero();
    $("avatar").src = ch.img; $("avatar").alt = ch.name;
    $("crewName").textContent = S.name || "還沒有航海員";
    $("crewSub").textContent = S.name ? (S.cls ? S.cls + " 班・" : "") + "夥伴 " + ch.name : "建立角色後就能出航收集飛魚。";
    $("crewBtn").textContent = S.name ? "更換" : "建立航海員";
    const c = clearedN(), st = totalStars();
    $("pLv").textContent = c + " / " + ORDER.length + " 關";
    $("pStar").textContent = "★ " + st + "/" + ORDER.length * 3;
    $("pBar").style.width = (c / ORDER.length * 100) + "%";
    $("tbStar").textContent = "★ " + st;
    $("scProg").textContent = c + " / " + ORDER.length + " 關";
    const cur = curIsland(), nx = nextId();

    $("ichips").innerHTML = ISLANDS.map((isl, i) => {
      const n = isl.levels.filter(k => S.stars[k] > 0).length, lk = !unlocked(isl.levels[0]), done = n === isl.levels.length;
      return `<button class="ichip ${i === sel ? "on" : ""} ${lk ? "locked" : ""}" data-i="${i}" role="tab" aria-selected="${i === sel}">
        <span class="ic">${lk ? "🔒" : done ? "🏁" : i + 1}</span><span class="in">${esc(isl.name)}</span><span class="ix">${n}/${isl.levels.length}</span></button>`;
    }).join("");

    const isl = ISLANDS[sel];
    $("ilist").innerHTML = `<div class="ihead"><small>第 ${sel + 1} 座島・${esc(isl.sub)}</small><h2>${esc(isl.name)}</h2></div>` +
      isl.levels.map(k => {
        const L = LV[k], n = ORDER.indexOf(k) + 1, s = S.stars[k] || 0, ok = unlocked(k);
        const cls = s > 0 ? "cleared" : (k === nx ? "next" : "");
        const go = s > 0 ? "再挑戰" : ok ? (k === nx ? "出發" : "前往") : "🔒";
        return `<button class="lv ${cls}" data-lv="${k}" ${ok ? "" : "disabled"}>
          <span class="no">${n}</span><span class="nm">${esc(L.name)}</span><span class="go">${go}</span>
          <span class="st">${s > 0 ? starStr(s) + "・" + esc(L.fish) : ok ? (k === nx ? "下一站" : "可前往") : "通過前一關才會開放"}</span></button>`;
      }).join("");

    $("fishBtn").textContent = `🐟 飛魚 ${c}/${ORDER.length}`;
    $("certBtn").disabled = !allDone();
    $("certBtn").title = allDone() ? "" : "九關都通過後就能領取";

    if (has3D) World.setStatus(ISLANDS.map((isl, i) => ({
      name: esc(isl.name), locked: !unlocked(isl.levels[0]),
      done: isl.levels.every(k => S.stars[k] > 0),
      count: isl.levels.filter(k => S.stars[k] > 0).length, total: isl.levels.length
    })), sel, allDone() ? -1 : cur, ch.img);
  }

  $("ichips").addEventListener("click", e => {
    const b = e.target.closest("[data-i]"); if (!b) return;
    sel = +b.dataset.i; render(); if (has3D) World.focus(sel);
  });
  $("ilist").addEventListener("click", e => {
    const b = e.target.closest("[data-lv]"); if (b && !b.disabled) openLevel(b.dataset.lv);
  });
  $("crewBtn").addEventListener("click", showSetup);
  $("fishBtn").addEventListener("click", showFish);
  $("checkBtn").addEventListener("click", showCheck);
  $("certBtn").addEventListener("click", showCert);
  $("zIn").addEventListener("click", () => has3D && World.zoom(0.75));
  $("zOut").addEventListener("click", () => has3D && World.zoom(1.33));
  $("zAll").addEventListener("click", () => has3D && World.overview());
  $("zReset").addEventListener("click", () => { sel = curIsland(); render(); has3D && World.focus(sel); });

  /* ---------- 音樂 ---------- */
  function syncMusic() {
    const on = !!(window.Sound && Sound.playing);
    $("musicBtn").setAttribute("aria-pressed", on);
    $("musicBtn").textContent = on ? "♪ 關閉音樂" : "♪ 開啟音樂";
    const w = $("wMusic");
    if (w) { w.setAttribute("aria-pressed", on); w.textContent = on ? "♪ 音樂播放中" : "♪ 開啟航海音樂"; }
  }
  function toggleMusic() { if (window.Sound) Sound.toggleMusic(); syncMusic(); }
  $("musicBtn").addEventListener("click", toggleMusic);

  /* ---------- 選單 ---------- */
  const menu = $("menu");
  let armed = false;
  $("menuBtn").addEventListener("click", e => {
    e.stopPropagation(); menu.hidden = !menu.hidden; $("menuBtn").setAttribute("aria-expanded", !menu.hidden);
  });
  document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; $("menuBtn").setAttribute("aria-expanded", false); } });
  menu.addEventListener("click", e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act;
    if (a === "reset") {
      if (!armed) { armed = true; b.textContent = "再按一次，清除所有進度"; setTimeout(() => { armed = false; b.textContent = "重新開始航行"; }, 4000); return; }
      armed = false; b.textContent = "重新開始航行";
      S.stars = {}; S.check = []; save(); sel = 0; render(); if (has3D) World.focus(0);
    }
    menu.hidden = true;
    if (a === "crew") showSetup();
    if (a === "fish") showFish();
    if (a === "check") showCheck();
    if (a === "cert") { if (allDone()) showCert(); else openDlg("航海證書", `<div class="note">九關都通過後，就能領取航海證書。目前通過 ${clearedN()} / ${ORDER.length} 關。</div>`); }
    if (a === "intro") showWelcome();
  });

  /* ---------- 對話框 ---------- */
  let onCloseCb = null;
  function openDlg(title, html, opt) {
    opt = opt || {};
    $("dTitle").textContent = title;
    $("pips").innerHTML = "";
    $("dBody").innerHTML = html;
    $("ov").hidden = false;
    onCloseCb = opt.onClose || null;
    $("ov").querySelector(".dlg").scrollTop = 0;
    setTimeout(() => { const f = $("dBody").querySelector("[autofocus]") || $("dClose"); f && f.focus(); }, 30);
  }
  function closeDlg() {
    $("ov").hidden = true; R = null;
    const cb = onCloseCb; onCloseCb = null;
    render();
    cb && cb();
  }
  $("dClose").addEventListener("click", closeDlg);
  $("ov").addEventListener("click", e => { if (e.target.id === "ov") closeDlg(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("ov").hidden) closeDlg(); });

  /* ---------- 開場與建立角色 ---------- */
  function showWelcome() {
    const pics = CHARACTERS.slice(0, 5).map(c => `<img src="${c.img}" alt="">`).join("");
    openDlg("航海邀請", `<div class="welcome">
      <div class="chars">${pics}</div>
      <div class="eyebrow">LANYU LEARNING PORTFOLIO</div>
      <h2>歡迎來到學習歷程島</h2>
      <p>群島上有五座島，每座島是一段學習歷程撰寫技巧。讀完航海筆記、答對題目就能捕到飛魚；九條飛魚都到手，就能領取航海證書。</p>
      <p class="saying">「蘭嶼的航海員，準備出發了嗎？」</p>
      <div class="acts center"><button class="btn ghost" id="wMusic" aria-pressed="false">♪ 開啟航海音樂</button><button class="btn" id="wGo" autofocus>接受邀請</button></div>
      <p class="small">接受邀請後，填名字和班級、挑一位航海夥伴，就能出發！</p></div>`,
      { onClose: () => { if (!S.intro) { S.intro = true; save(); } } });
    syncMusic();
    $("wMusic").onclick = toggleMusic;
    $("wGo").onclick = () => { S.intro = true; save(); showSetup(); };
  }

  function showSetup() {
    let pick = S.char;
    openDlg("建立航海員", `<div class="setup">
      <div class="frow">
        <label>航海員名字<input id="fName" maxlength="12" placeholder="輸入你的名字" value="${esc(S.name)}" autofocus></label>
        <label>班級<input id="fCls" maxlength="6" inputmode="numeric" placeholder="例如 201" value="${esc(S.cls)}"></label>
      </div>
      <div class="lbl">挑一位航海夥伴</div>
      <div class="cgrid" id="cgrid">${CHARACTERS.map((c, i) => `<button class="cpick" data-c="${i}" aria-pressed="${i === pick}"><img src="${c.img}" alt=""><b>${esc(c.name)}</b><small>${esc(c.line)}</small></button>`).join("")}</div>
      <p class="err" id="fErr" hidden>請先寫上名字。</p>
      <div class="acts"><button class="btn" id="fGo">出發！</button></div></div>`);
    $("cgrid").addEventListener("click", e => {
      const b = e.target.closest("[data-c]"); if (!b) return;
      pick = +b.dataset.c;
      $("cgrid").querySelectorAll(".cpick").forEach(x => x.setAttribute("aria-pressed", +x.dataset.c === pick));
      window.Sound && Sound.tap();
    });
    $("fGo").onclick = () => {
      const n = $("fName").value.trim();
      if (!n) { $("fErr").hidden = false; $("fName").focus(); return; }
      S.name = n.slice(0, 12); S.cls = $("fCls").value.trim().slice(0, 6); S.char = pick; S.intro = true; save();
      closeDlg();
      sel = curIsland(); render(); if (has3D) World.focus(sel);
    };
  }

  /* ---------- 飛魚收藏、檢核表 ---------- */
  function showFish() {
    const c = clearedN();
    openDlg("飛魚收藏 " + c + "/" + ORDER.length, `<p style="margin:0;color:var(--muted)">每通過一關，就有一條飛魚游進你的拼板舟。</p>
      <div class="fishgrid">${ORDER.map((k, i) => { const got = S.stars[k] > 0; return `<div class="fish ${got ? "got" : ""}">${fishSVG(FISHCOL[i])}${got ? esc(LV[k].fish) + "<br>" + starStr(S.stars[k]) : "第 " + (i + 1) + " 關"}</div>`; }).join("")}</div>`);
  }
  function showCheck() {
    const draw = () => {
      $("ckList").innerHTML = CHECK.map((t, i) => `<li><label><input type="checkbox" data-ck="${i}" ${S.check[i] ? "checked" : ""}><span>${esc(t)}</span></label></li>`).join("");
      $("ckProg").textContent = CHECK.filter((_, i) => S.check[i]).length + " / " + CHECK.length + " 項";
    };
    openDlg("上傳前自我檢核", `<p style="margin:0;color:var(--muted)">每一件作品上傳前，都先對照這張表。勾選只存在這台裝置上。<b id="ckProg" style="float:right;color:var(--ink)"></b></p>
      <ul class="cklist" id="ckList"></ul>
      <div class="acts"><button class="btn ghost" id="ckReset">換下一件作品，清除勾選</button></div>`);
    draw();
    $("ckList").addEventListener("change", e => { const i = e.target.dataset.ck; if (i != null) { S.check[i] = e.target.checked; save(); draw(); } });
    $("ckReset").onclick = () => { S.check = []; save(); draw(); };
  }

  /* ---------- 證書 ---------- */
  function showCert() {
    const d = new Date(), date = `${d.getFullYear() - 1911} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    const st = totalStars();
    openDlg("航海證書", `<div class="cert">
      <div class="eyebrow">CERTIFICATE OF VOYAGE</div>
      <h2>學習歷程航海證書</h2>
      <div class="heroes"><img src="${hero().img}" alt="${esc(hero().name)}"></div>
      <p>茲證明</p>
      <div class="who">${S.cls ? esc(S.cls) + " 班　" : ""}${esc(S.name || "航海員")}</div>
      <p>划著拼板舟繞過學習歷程島的五座島，<br>通過 ${ORDER.length} 道關卡、收集 ${ORDER.length} 條飛魚，獲得 <b style="color:var(--gold)">★ ${st}</b> 顆星。</p>
      <p>上傳每一件作品前，記得再對照一次檢核表。</p>
      <p class="meta">蘭嶼高中 教學組　${date}</p>
    </div>
    <div class="acts noprint"><button class="btn ghost" id="cClose">關閉</button><button class="btn" id="cPrint" autofocus>列印證書</button></div>`);
    $("cPrint").onclick = () => window.print();
    $("cClose").onclick = closeDlg;
  }

  /* ---------- 闖關 ---------- */
  let R = null;
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function openLevel(id) {
    R = { id, L: LV[id], i: -1, res: [] };
    sel = islandOf(id);
    if (has3D) World.focus(sel);
    openDlg("第 " + (ORDER.indexOf(id) + 1) + " 關・" + R.L.name, "");
    showNote();
  }
  function pips() { if (!R) return; $("pips").innerHTML = R.L.qs.map((_, i) => `<span class="pip ${R.res[i] === true ? "ok" : R.res[i] === false ? "ng" : i === R.i ? "cur" : ""}"></span>`).join(""); }
  function showNote() {
    pips(); const n = R.L.note;
    $("dBody").innerHTML = `<div class="guide"><img src="${hero().img}" alt=""><div class="say">${S.name ? esc(S.name) + "，" : ""}先讀航海筆記，再開始答題喔！</div></div>
      <div class="note"><h3>航海筆記：${esc(n.h)}</h3>${n.p ? `<p style="margin:0">${esc(n.p)}</p>` : ""}<ul>${n.li.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="acts"><button class="btn" id="go">讀完了，開始答題（${R.L.qs.length} 題）</button></div>`;
    $("go").onclick = () => { R.i = 0; showQ(); };
    $("go").focus();
  }
  function showQ() {
    pips(); const q = R.L.qs[R.i], B = $("dBody");
    let html = `<div class="q">${R.i + 1}. ${esc(q.q)}</div>`;
    if (q.t === "mc") {
      q._o = shuffle(q.o.map((t, k) => ({ t, k })));
      html += `<div class="opts">${q._o.map((o, j) => `<button class="opt" data-j="${j}"><span class="tag">${"ABCD"[j]}</span>${esc(o.t)}</button>`).join("")}</div>`;
    } else if (q.t === "order") {
      q._o = shuffle(q.items.map((t, k) => ({ t, k }))); q._pick = [];
      html += `<div class="seq" id="seq" aria-live="polite"></div>
        <div class="opts">${q._o.map((o, j) => `<button class="opt" data-j="${j}">${esc(o.t)}</button>`).join("")}</div>
        <div class="acts"><button class="btn ghost" id="redo">重排</button><button class="btn" id="sub" disabled>確認</button></div>`;
    } else {
      q._o = shuffle(q.items.map(([t, b]) => ({ t, b }))); q._pick = q._o.map(() => null);
      html += `<div class="opts">${q._o.map((o, j) => `<div class="sortrow" id="row${j}"><div>${esc(o.t)}</div><div class="bins">${q.bins.map((bn, b) => `<button class="bin" data-r="${j}" data-b="${b}" aria-pressed="false">${esc(bn)}</button>`).join("")}</div></div>`).join("")}</div>
        <div class="acts"><button class="btn" id="sub" disabled>確認</button></div>`;
    }
    html += `<div id="fb"></div>`;
    B.innerHTML = html;
    $("ov").querySelector(".dlg").scrollTop = 0;

    if (q.t === "mc") {
      B.querySelectorAll(".opt").forEach(b => b.onclick = () => {
        const j = +b.dataset.j, ok = q._o[j].k === q.a;
        B.querySelectorAll(".opt").forEach((x, jj) => { x.disabled = true; if (q._o[jj].k === q.a) x.classList.add("ok"); });
        if (!ok) b.classList.add("ng");
        answer(ok);
      });
    } else if (q.t === "order") {
      const seq = $("seq"), sub = $("sub");
      const draw = () => {
        seq.innerHTML = q._pick.length ? q._pick.map(j => `<span class="chip">${esc(q._o[j].t)}</span>`).join("") : `<span style="color:var(--muted);font-size:14px">依序點下面的選項</span>`;
        B.querySelectorAll(".opt").forEach(x => { const j = +x.dataset.j; x.disabled = q._pick.includes(j); x.classList.toggle("pick", q._pick.includes(j)); });
        sub.disabled = q._pick.length !== q.items.length;
      };
      draw();
      B.querySelectorAll(".opt").forEach(b => b.onclick = () => { q._pick.push(+b.dataset.j); draw(); });
      $("redo").onclick = () => { q._pick = []; draw(); };
      sub.onclick = () => {
        const ok = q._pick.every((j, p) => q._o[j].k === p);
        B.querySelectorAll(".opt,#redo").forEach(x => x.disabled = true); sub.disabled = true;
        if (!ok) seq.insertAdjacentHTML("afterend", `<div class="fb" style="background:var(--sea)"><b>正確順序</b>${q.items.map(esc).join(" → ")}</div>`);
        answer(ok);
      };
    } else {
      const sub = $("sub");
      B.querySelectorAll(".bin").forEach(b => b.onclick = () => {
        const r = +b.dataset.r; q._pick[r] = +b.dataset.b;
        $("row" + r).querySelectorAll(".bin").forEach(x => x.setAttribute("aria-pressed", +x.dataset.b === q._pick[r]));
        sub.disabled = q._pick.some(v => v === null);
      });
      sub.onclick = () => {
        let ok = true;
        q._o.forEach((o, j) => {
          const good = q._pick[j] === o.b; ok = ok && good;
          const row = $("row" + j); row.classList.add(good ? "ok" : "ng");
          if (!good) row.insertAdjacentHTML("beforeend", `<div style="font-size:14px;color:var(--muted)">應該是：${esc(q.bins[o.b])}</div>`);
        });
        B.querySelectorAll(".bin").forEach(x => x.disabled = true); sub.disabled = true;
        answer(ok);
      };
    }
  }
  function answer(ok) {
    R.res[R.i] = ok; pips();
    if (window.Sound) ok ? Sound.ok() : Sound.ng();
    const q = R.L.qs[R.i], last = R.i === R.L.qs.length - 1;
    $("fb").innerHTML = `<div class="fb ${ok ? "ok" : "ng"}"><b>${ok ? "答對了！" : "再想想"}</b>${esc(q.why)}</div>
      <div class="acts" style="margin-top:12px"><button class="btn" id="nx">${last ? "看結果" : "下一題"}</button></div>`;
    $("nx").onclick = () => { if (last) finish(); else { R.i++; showQ(); } };
    $("nx").focus();
    $("nx").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function finish() {
    const wrong = R.res.filter(x => !x).length, st = wrong === 0 ? 3 : wrong <= 1 ? 2 : 1;
    const prev = S.stars[R.id] || 0; S.stars[R.id] = Math.max(prev, st); save();
    const idx = ORDER.indexOf(R.id), next = ORDER[idx + 1], who = S.name ? esc(S.name) + "，" : "";
    if (window.Sound) Sound.win();
    if (has3D) World.splash(islandOf(R.id));
    R.i = -1; pips();
    const id = R.id;
    $("dBody").innerHTML = `<div class="result">
      <div class="duo"><img src="${hero().img}" alt="">${fishSVG(FISHCOL[idx])}</div>
      <div class="big">${who}你捕到了${esc(R.L.fish)}！</div>${starStr(st)}
      <div style="color:var(--muted)">答對 ${R.res.length - wrong} / ${R.res.length} 題${prev > st ? "（保留你之前的 " + prev + " 顆星）" : ""}</div>
      ${!next ? `<div class="note" style="text-align:left;margin-top:8px">五座島都繞完了！領取航海證書，並在每一件作品上傳前對照「上傳前檢核表」。</div>` : ""}</div>
      <div class="acts"><button class="btn ghost" id="again">再挑戰一次</button>${next ? `<button class="btn" id="nxl">前往下一關</button>` : `<button class="btn" id="cert">領取航海證書</button>`}</div>`;
    render();
    $("again").onclick = () => openLevel(id);
    if (next) $("nxl").onclick = () => openLevel(next);
    else $("cert").onclick = showCert;
  }

  /* ---------- 開始 ---------- */
  render();
  if (has3D) World.focus(sel);
  if (!S.intro) showWelcome();
})();
