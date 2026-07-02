/* anim-pipe reference runtime — dependency-free bundle player.
 *
 * This file is the SEMANTIC CONTRACT for the final game. A compiled game may
 * restyle everything, but traversal must behave exactly like this:
 *
 *   1. A queued choice whose from-node is the current node (and whose
 *      condition holds) plays first and is consumed.
 *   2. Otherwise an `auto` edge from the current node whose condition holds
 *      fires (weighted pick among available autos).
 *   3. Otherwise, if choices are queued, walk the shortest idle path toward
 *      the head choice's from-node (fallback: weighted idle).
 *   4. Otherwise take a weighted-random available `idle` edge.
 *   5. No edge available → hold on the current node's still.
 *
 *   Effects apply when an edge FINISHES traversing (on arrival). `once`
 *   edges leave the pool after one traversal. Conditions are ANDed clauses
 *   over the variable bag; booleans compare as 0/1. Edges without a clip
 *   fall back to the destination still + a hold timer.
 *
 * Serve the bundle over HTTP (e.g. `python -m http.server`) — fetch() of
 * graph.json does not work from file://.
 */
(() => {
  "use strict";

  const HOLD_MS = 2500;
  const $ = (id) => document.getElementById(id);
  const isVideo = (p) => /\.(webm|mp4|mov|m4v|ogv)$/i.test(p || "");
  const num = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : v || 0);

  /* ---------- pure semantics (ported from the studio engine) ---------- */
  const evalClauses = (clauses, vars) =>
    !clauses || clauses.length === 0 ||
    clauses.every((c) => {
      const a = num(vars[c.var]);
      const b = num(c.value);
      switch (c.op) {
        case "==": return a === b;
        case "!=": return a !== b;
        case ">": return a > b;
        case ">=": return a >= b;
        case "<": return a < b;
        case "<=": return a <= b;
        default: return true;
      }
    });

  const applyEffects = (effects, vars) => {
    for (const ef of effects || []) {
      vars[ef.var] = ef.op === "set" ? ef.value : num(vars[ef.var]) + num(ef.value);
    }
  };

  const available = (e, vars, used) =>
    (!e.once || !used.has(e.id)) && evalClauses(e.condition, vars);

  const edgesFrom = (edges, node, type) =>
    edges.filter((e) => e.from === node && (!type || e.type === type));

  function pickWeighted(list) {
    if (list.length === 0) return null;
    const total = list.reduce((s, e) => s + (e.weight || 1), 0);
    let r = Math.random() * total;
    for (const e of list) {
      r -= e.weight || 1;
      if (r <= 0) return e;
    }
    return list[list.length - 1];
  }

  function buildNextHop(nodeIds, edges) {
    const idle = edges.filter((e) => e.type === "idle");
    const table = {};
    for (const target of nodeIds) {
      const dist = { [target]: 0 };
      const q = [target];
      while (q.length) {
        const n = q.shift();
        for (const e of idle) {
          if (e.to === n && dist[e.from] === undefined) {
            dist[e.from] = dist[n] + 1;
            q.push(e.from);
          }
        }
      }
      for (const from of nodeIds) {
        if (from === target) continue;
        const best = idle
          .filter((e) => e.from === from && dist[e.to] === dist[from] - 1)
          .sort((x, y) => (y.weight || 1) - (x.weight || 1))[0];
        if (best) (table[from] = table[from] || {})[target] = best;
      }
    }
    return table;
  }

  function chooseNext(edges, nextHop, node, queue, vars, used) {
    const ok = (e) => available(e, vars, used);
    const qi = queue.findIndex((e) => e.from === node && ok(e));
    if (qi >= 0) return { edge: queue[qi], consumeIdx: qi };
    const auto = pickWeighted(edgesFrom(edges, node, "auto").filter(ok));
    if (auto) return { edge: auto };
    if (queue.length > 0) {
      const hop = nextHop[node] && nextHop[node][queue[0].from];
      const edge = hop && ok(hop) ? hop : pickWeighted(edgesFrom(edges, node, "idle").filter(ok));
      if (edge) return { edge };
    }
    const edge = pickWeighted(edgesFrom(edges, node, "idle").filter(ok));
    return edge ? { edge } : null;
  }

  /* ---------- bundle state ---------- */
  let nodes = {};   // id -> {id, key, title, image, logic}
  let edges = [];   // engine-shaped edges
  let defaults = {};
  let startNode = null;
  let nextHop = {};
  let state = null;
  let holdTimer = null;

  const engineEdge = (e) => {
    const l = e.logic || {};
    return {
      id: e.id,
      from: e.from,
      to: e.to,
      type: l.type === "choice" ? "interaction" : l.type === "auto" ? "auto" : "idle",
      trigger: l.type === "choice" ? l.trigger || e.label : null,
      weight: l.weight || 1,
      condition: l.condition || [],
      effects: l.effects || [],
      once: !!l.once,
      clip: e.clip || null,
      label: e.label || "",
    };
  };

  function restart() {
    if (holdTimer) clearTimeout(holdTimer);
    state = { node: startNode, edge: null, queue: [], vars: { ...defaults }, used: new Set() };
    advance();
  }

  function advance() {
    if (holdTimer) clearTimeout(holdTimer);
    const s = state;
    if (s.edge) {
      s.node = s.edge.to;
      applyEffects(s.edge.effects, s.vars);
      if (s.edge.once) s.used.add(s.edge.id);
    }
    if (!s.node) return render();
    const here = s.node;
    s.queue = s.queue.filter((e) => e.from !== here || available(e, s.vars, s.used));
    const choice = chooseNext(edges, nextHop, s.node, s.queue, s.vars, s.used);
    if (!choice) {
      s.edge = null; // dead end: hold on the still
    } else {
      if (choice.consumeIdx !== undefined) s.queue.splice(choice.consumeIdx, 1);
      s.edge = choice.edge;
    }
    render();
  }

  function trigger(name) {
    const s = state;
    const edge = edges.find(
      (e) => e.type === "interaction" && e.trigger === name && available(e, s.vars, s.used),
    );
    if (!edge || s.queue.some((q) => q.id === edge.id)) return;
    s.queue.push(edge);
    // Holding on a dead end? A new choice must wake the walker.
    if (!s.edge) return advance();
    render();
  }

  /* ---------- rendering ---------- */
  function renderStage() {
    const stage = $("stage");
    stage.innerHTML = "";
    const s = state;
    const clip = s.edge && s.edge.clip;
    if (clip && isVideo(clip)) {
      const v = document.createElement("video");
      v.src = clip;
      v.autoplay = true;
      v.muted = true;
      v.playsInline = true;
      v.onended = advance;
      v.onerror = advance;
      stage.appendChild(v);
      return;
    }
    // gif/webp clip, or still fallback for a clip-less edge / dead-end hold
    const src = clip || (s.edge ? nodes[s.edge.to]?.image : nodes[s.node]?.image);
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      stage.appendChild(img);
    } else {
      const d = document.createElement("div");
      d.className = "empty";
      d.textContent = "(no keyframe exported for this node)";
      stage.appendChild(d);
    }
    if (s.edge) holdTimer = setTimeout(advance, HOLD_MS);
  }

  function renderSide() {
    const s = state;
    const choicesEl = $("choices");
    choicesEl.innerHTML = "";
    for (const e of edges) {
      if (e.type !== "interaction" || !e.trigger) continue;
      const b = document.createElement("button");
      const here = e.from === s.node;
      b.textContent = e.trigger + (here ? "" : " · @" + (nodes[e.from]?.title || nodes[e.from]?.key || "?"));
      b.disabled = !available(e, s.vars, s.used) || s.queue.some((q) => q.id === e.id);
      b.onclick = () => trigger(e.trigger);
      choicesEl.appendChild(b);
    }
    const varsEl = $("vars");
    varsEl.innerHTML = "";
    for (const [k, v] of Object.entries(s.vars)) {
      const row = document.createElement("div");
      row.className = "varRow";
      row.innerHTML = `<span>${k}</span><b>${v}</b>`;
      varsEl.appendChild(row);
    }
    const at = s.edge ? nodes[s.edge.to] : nodes[s.node];
    $("where").textContent = at ? at.title || at.key : "—";
    const lines = (at && at.logic && at.logic.dialogue) || [];
    $("dialogue").textContent = lines.length
      ? lines[Math.floor(Math.random() * lines.length)]
      : "";
  }

  function render() {
    renderStage();
    renderSide();
  }

  /* ---------- boot ---------- */
  async function boot() {
    const bundle = await (await fetch("graph.json")).json();
    const scene =
      bundle.scenes.find((sc) => sc.id === bundle.start_scene) || bundle.scenes[0];
    if (!scene) {
      $("stage").textContent = "Empty bundle.";
      return;
    }
    document.title = bundle.project.name;
    $("title").textContent = bundle.project.name + " · " + scene.name;
    nodes = Object.fromEntries(scene.nodes.map((n) => [n.id, n]));
    edges = scene.edges.filter((e) => nodes[e.from] && nodes[e.to]).map(engineEdge);
    defaults = Object.fromEntries((bundle.variables || []).map((v) => [v.name, v.default]));
    startNode = scene.start && nodes[scene.start] ? scene.start : scene.nodes[0]?.id ?? null;
    nextHop = buildNextHop(Object.keys(nodes), edges);
    $("restart").onclick = restart;
    restart();
  }

  boot().catch((err) => {
    $("stage").innerHTML =
      "<div class='empty'>Failed to load graph.json — serve this folder over HTTP " +
      "(e.g. <code>python -m http.server</code>).<br><br>" + err + "</div>";
  });
})();
