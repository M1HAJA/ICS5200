document.addEventListener("DOMContentLoaded", () => {

  /* ============================================================
     DATA — Add your papers here
     Format: ["Title", "PESTLE tags (comma-separated)", "URL"]
     Valid tags: Political, Economic, Social, Technological, Legal, Environmental
     Use "" for URL if unavailable
     ============================================================ */

  const CSV_ROWS = [
    // ── ADD YOUR PAPERS BELOW THIS LINE ──────────────────────────────────────
    // ["Paper Title Here", "Political, Social, Technological", "https://link"],
    // ─────────────────────────────────────────────────────────────────────────
  ];

  const PAPERS_FULL = CSV_ROWS.map(([title, pestleStr, url]) => ({
    title,
    pestle: String(pestleStr || "").split(",").map(s => s.trim()).filter(Boolean),
    url: (url && String(url).trim()) ? String(url).trim() : null
  }));

  /* ============================================================
     MODEL DEMO — Gradio Space API
     Space: https://huggingface.co/spaces/M1HAJA/cyberbulling-api
     ============================================================ */

  const SPACE_BASE = "https://m1haja-cyberbulling-api.hf.space";

  const MODELS = {
    bertu: {
      gradioName: "BERTu",
      note: "BERTu — Maltese-specific transformer. Best overall performance (Macro F1: 0.867)."
    },
    mbertu: {
      gradioName: "mBERTu",
      note: "mBERTu — Multilingual transformer further trained on Maltese. (Macro F1: 0.839)."
    }
  };

  let activeModel = "bertu";

  const btnBertu   = document.getElementById("btnBertu");
  const btnMbertu  = document.getElementById("btnMbertu");
  const modelNote  = document.getElementById("demoModelNote");
  const demoInput  = document.getElementById("demoInput");
  const demoBtn    = document.getElementById("demoBtn");
  const demoResult = document.getElementById("demoResult");
  const charCount  = document.getElementById("demoCharCount");

  function setActiveModel(key) {
    activeModel = key;
    btnBertu.classList.toggle("active",  key === "bertu");
    btnMbertu.classList.toggle("active", key === "mbertu");
    modelNote.textContent = MODELS[key].note;
    demoResult.className  = "demo-result";
    demoResult.innerHTML  = "";
  }

  if (btnBertu)  btnBertu.addEventListener("click",  () => setActiveModel("bertu"));
  if (btnMbertu) btnMbertu.addEventListener("click", () => setActiveModel("mbertu"));

  if (demoInput) {
    demoInput.addEventListener("input", () => {
      if (charCount) charCount.textContent = demoInput.value.length;
    });
  }

  setActiveModel("bertu");

  /* ---------- Classify via Gradio 6 /gradio_api/call/predict + SSE ---------- */
  // Step 1: POST to get event_id
  // Step 2: GET SSE stream, listen for "complete" event

  async function classifyText(text, modelName) {
    const postRes = await fetch(`${SPACE_BASE}/gradio_api/call/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [text, modelName] })
    });

    const postRaw = await postRes.text();
    if (!postRes.ok) throw new Error(`Submit failed (${postRes.status}): ${postRaw}`);

    let eventId;
    try { eventId = JSON.parse(postRaw).event_id; }
    catch (_) { throw new Error("Could not parse event_id: " + postRaw); }
    if (!eventId) throw new Error("No event_id returned: " + postRaw);

    return new Promise((resolve, reject) => {
      const es = new EventSource(`${SPACE_BASE}/gradio_api/call/predict/${eventId}`);

      const timeout = setTimeout(() => {
        es.close();
        reject(new Error("Timed out (30s). The Space may be waking up — please try again."));
      }, 30000);

      es.addEventListener("complete", (e) => {
        clearTimeout(timeout);
        es.close();
        let parsed;
        try { parsed = JSON.parse(e.data); }
        catch (_) { reject(new Error("Could not parse result: " + e.data)); return; }

        // Gradio 6 returns array: [ { "Harmful Content": 0.78, ... } ]
        const result = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!result || typeof result !== "object") {
          reject(new Error("Unexpected result shape: " + e.data)); return;
        }
        resolve(Object.entries(result).map(([label, score]) => ({ label, score })));
      });

      es.addEventListener("error", (e) => {
        clearTimeout(timeout);
        es.close();
        const msg = e.data
          ? (() => { try { return JSON.parse(e.data).message; } catch { return e.data; } })()
          : "Connection lost";
        reject(new Error(msg || "Space error — it may be starting up, please try again."));
      });
    });
  }

  /* ---------- Button handler ---------- */

  if (demoBtn) {
    demoBtn.addEventListener("click", async () => {
      const text = demoInput ? demoInput.value.trim() : "";
      if (!text) {
        showError("Please enter some text to classify.");
        return;
      }

      showLoading();
      demoBtn.disabled = true;

      const model = MODELS[activeModel];

      try {
        const scores = await classifyText(text, model.gradioName);

        if (!scores.length) {
          showError("No scores returned from model.");
          demoBtn.disabled = false;
          return;
        }

        const top = scores.reduce((a, b) => a.score > b.score ? a : b);
        showResult(top, scores, model.gradioName);

      } catch (err) {
        showError(err.message || String(err));
      }

      demoBtn.disabled = false;
    });
  }

  /* ---------- Renderers ---------- */

  function showLoading() {
    demoResult.className = "demo-result loading";
    demoResult.innerHTML = `<div class="spinner"></div><span>Classifying — please wait…</span>`;
  }

  function showResult(top, allScores, modelName) {
    const isHarmful = top.label === "Harmful Content";
    const cls       = isHarmful ? "result-harmful" : "result-safe";
    const icon      = isHarmful ? "⚠️" : "✅";
    const pct       = (top.score * 100).toFixed(1);

    const barsHtml = allScores.map(item => {
      const isH    = item.label === "Harmful Content";
      const barCls = isH ? "harmful" : "safe";
      const w      = (item.score * 100).toFixed(1);
      return `
        <div class="score-bar-wrap">
          <div class="score-bar-label">
            <span>${escapeHtml(item.label)}</span>
            <span>${w}%</span>
          </div>
          <div class="score-bar-bg">
            <div class="score-bar-fill ${barCls}" style="width:${w}%"></div>
          </div>
        </div>`;
    }).join("");

    demoResult.className = `demo-result ${cls}`;
    demoResult.innerHTML = `
      <div class="result-label">${icon} ${escapeHtml(top.label)}</div>
      <div class="result-score">Confidence: ${pct}% &nbsp;·&nbsp; Model: ${escapeHtml(modelName)}</div>
      <div class="result-scores-row">${barsHtml}</div>
    `;
  }

  function showError(msg) {
    demoResult.className = "demo-result result-error";
    demoResult.innerHTML = `
      <div class="result-label">⚠️ Could not classify</div>
      <div class="result-score" style="white-space:pre-wrap">${escapeHtml(msg)}</div>`;
  }

  /* ============================================================
     PESTLE MAP
     ============================================================ */

  const pestleMapEl      = document.getElementById("pestleMap");
  const pestleModal      = document.getElementById("pestleModal");
  const pestleModalTitle = document.getElementById("pestleModalTitle");
  const pestleModalMeta  = document.getElementById("pestleModalMeta");
  const pestleModalList  = document.getElementById("pestleModalList");
  const pestleCloseBtn   = pestleModal ? pestleModal.querySelector('[data-close="pestle"]') : null;

  function groupByTag(papers) {
    const map = new Map();
    for (const p of papers) {
      for (const tag of p.pestle) {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag).push(p);
      }
    }
    for (const [, list] of map.entries()) {
      list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    }
    return map;
  }

  function buildPestleMap() {
    if (!pestleMapEl) return;

    const tagToPapers = groupByTag(PAPERS_FULL);

    if (tagToPapers.size === 0) {
      pestleMapEl.innerHTML = '<p style="color:var(--muted2);font-size:13px;padding:24px 0;text-align:center;font-style:italic;">Papers will appear here once added to script.js</p>';
      return;
    }

    const tags  = Array.from(tagToPapers.keys());
    const order = ["Political","Economic","Social","Technological","Legal","Environmental"];
    tags.sort((a, b) => order.indexOf(a) - order.indexOf(b));

    const counts  = tags.map(t => tagToPapers.get(t).length);
    const minC    = Math.min(...counts);
    const maxC    = Math.max(...counts);
    const minSize = 88;
    const maxSize = 168;

    pestleMapEl.innerHTML = "";

    tags.forEach(tag => {
      const count  = tagToPapers.get(tag).length;
      const t      = (maxC === minC) ? 0.5 : (count - minC) / (maxC - minC);
      const curved = Math.pow(t, 0.75);
      const size   = Math.round(minSize + curved * (maxSize - minSize));

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pestle-bubble";
      btn.style.setProperty("--size", `${size}px`);
      btn.setAttribute("aria-label", `${tag}: ${count} paper${count === 1 ? "" : "s"}`);
      btn.title = `${tag}: ${count} paper${count === 1 ? "" : "s"}`;
      btn.innerHTML = `<span><span class="label">${tag}</span><span class="count">${count} paper${count === 1 ? "" : "s"}</span></span>`;
      btn.addEventListener("click", () => openPestleModal(tag, tagToPapers.get(tag)));
      pestleMapEl.appendChild(btn);
    });
  }

  function openPestleModal(tag, papers) {
    if (!pestleModal || !pestleModalTitle || !pestleModalList) return;

    pestleModalTitle.textContent = tag;
    pestleModalMeta.textContent  = `${papers.length} paper${papers.length === 1 ? "" : "s"} tagged under ${tag}.`;
    pestleModalList.innerHTML    = "";

    papers.forEach(p => {
      const item  = document.createElement("div");
      item.className = "paper-item";
      const left  = document.createElement("div");
      left.className = "left";
      left.innerHTML = `<div class="title">${escapeHtml(p.title)}</div>`;
      const right = document.createElement("div");
      right.className = "right";

      if (p.url) {
        const a = document.createElement("a");
        a.className   = "paper-link";
        a.href        = p.url;
        a.target      = "_blank";
        a.rel         = "noopener noreferrer";
        a.textContent = "Open ↗";
        right.appendChild(a);
      } else {
        const span       = document.createElement("span");
        span.className   = "paper-nolink";
        span.textContent = "Link unavailable";
        right.appendChild(span);
      }

      item.appendChild(left);
      item.appendChild(right);
      pestleModalList.appendChild(item);
    });

    pestleModal.classList.add("is-open");
    pestleModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (pestleCloseBtn) pestleCloseBtn.focus();
  }

  function closePestleModal() {
    if (!pestleModal) return;
    pestleModal.classList.remove("is-open");
    pestleModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  if (pestleCloseBtn) pestleCloseBtn.addEventListener("click", closePestleModal);

  if (pestleModal) {
    pestleModal.addEventListener("click", e => {
      const card = pestleModal.querySelector(".modal-card");
      if (card && !card.contains(e.target)) closePestleModal();
    });
  }

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (pestleModal && pestleModal.classList.contains("is-open")) closePestleModal();
  });

  /* ============================================================
     HELPERS
     ============================================================ */

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&",  "&amp;")
      .replaceAll("<",  "&lt;")
      .replaceAll(">",  "&gt;")
      .replaceAll('"',  "&quot;")
      .replaceAll("'",  "&#039;");
  }

  /* ============================================================
     INIT
     ============================================================ */

  buildPestleMap();
});
