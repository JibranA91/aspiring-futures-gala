/* dcx.js — a small, self-contained runtime for the Aspiring Futures gala app.
 *
 * The two screens were prototyped on a heavyweight CDN runtime (React + Babel
 * + a streaming template compiler, loaded via support.js). This file replaces
 * all of that with ~250 lines of dependency-free vanilla JS, so the app is a
 * plain static site with no build step and no CDN framework — it reproduces the
 * exact subset of that runtime the two templates use:
 *
 *   {{ path.expr }}      value + event-handler bindings (in text and attributes)
 *   <sc-for list as>     list rendering
 *   <sc-if value>        conditional rendering
 *   onClick / onChange…  DOM events (onChange fires on input for text fields)
 *   ref="{{ fn }}"       element ref callbacks
 *   key="{{ x }}"        identity for keyed reconciliation + animation replay
 *   value/checked/disabled controlled form properties
 *
 * The component contract mirrors the original DCLogic: state, props, setState,
 * componentDidMount / DidUpdate / WillUnmount, and renderVals(). Each render
 * rebuilds a lightweight vnode tree and a keyed reconciler patches it into the
 * DOM in place, so focused inputs keep their caret and CSS animations only
 * replay when a key changes or a node mounts — exactly as they did under React.
 */
(function () {
  "use strict";

  /* ── expression resolver ─────────────────────────────────────────────────
     A direct port of the design runtime's resolver: paths (a.b, a[b]), the
     literals true/false/null/undefined/number/'string', unary !, and the
     equality operators. It is NOT a general JS evaluator — bindings only ever
     read a value or a handler out of the render object. */
  var IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
  var NUMBER_RE = /^-?\d+(\.\d+)?$/;

  function resolve(vals, src) {
    var expr = String(src).trim();
    if (!expr) return undefined;
    if (expr[0] === "(" && expr[expr.length - 1] === ")" && parensWrapWhole(expr)) {
      return resolve(vals, expr.slice(1, -1));
    }
    var eq = findTopLevelEquality(expr);
    if (eq) {
      var lv = resolve(vals, expr.slice(0, eq.index));
      var rv = resolve(vals, expr.slice(eq.index + eq.op.length));
      switch (eq.op) {
        case "===": return lv === rv;
        case "!==": return lv !== rv;
        case "==": return lv == rv;
        default: return lv != rv;
      }
    }
    if (expr[0] === "!") return !resolve(vals, expr.slice(1));
    if (expr === "true") return true;
    if (expr === "false") return false;
    if (expr === "null") return null;
    if (expr === "undefined") return undefined;
    if (NUMBER_RE.test(expr)) return Number(expr);
    if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr[expr.length - 1] === expr[0]) {
      return expr.slice(1, -1);
    }
    return resolvePath(vals, expr);
  }

  function parensWrapWhole(expr) {
    var depth = 0;
    for (var i = 0; i < expr.length - 1; i++) {
      if (expr[i] === "(") depth++;
      else if (expr[i] === ")") { depth--; if (depth === 0) return false; }
    }
    return true;
  }

  function findTopLevelEquality(expr) {
    var depth = 0;
    for (var i = 0; i < expr.length; i++) {
      var c = expr[i];
      if (c === "[" || c === "(") depth++;
      else if (c === "]" || c === ")") depth--;
      else if (depth === 0 && (c === "=" || c === "!") && expr[i + 1] === "=") {
        if (i > 0 && (expr[i - 1] === "=" || expr[i - 1] === "!")) continue;
        if (!expr.slice(0, i).trim()) continue;
        var op = expr[i + 2] === "=" ? c + "==" : c + "=";
        return { index: i, op: op };
      }
    }
    return null;
  }

  function resolvePath(vals, expr) {
    var head = expr.match(IDENT_RE);
    if (!head) return undefined;
    var cur = vals == null ? undefined : vals[head[0]];
    var i = head[0].length;
    while (i < expr.length) {
      if (expr[i] === ".") {
        var m = expr.slice(i + 1).match(IDENT_RE) || expr.slice(i + 1).match(/^\d+/);
        if (!m) return undefined;
        cur = cur == null ? undefined : cur[m[0]];
        i += 1 + m[0].length;
      } else if (expr[i] === "[") {
        var depth = 1, j = i + 1;
        while (j < expr.length && depth > 0) {
          if (expr[j] === "[") depth++;
          else if (expr[j] === "]") { depth--; if (depth === 0) break; }
          j++;
        }
        if (depth !== 0) return undefined;
        var key = resolve(vals, expr.slice(i + 1, j));
        cur = cur == null ? undefined : cur[key];
        i = j + 1;
      } else return undefined;
    }
    return cur;
  }

  /* ── attribute / text compilation ────────────────────────────────────────
     Each attribute value and text node becomes a getter (vals) => value. A
     whole-value {{ x }} returns the raw resolved value (any type — string,
     number, boolean, or a handler function); mixed text interpolates to a
     string. */
  function compileAttr(raw) {
    var whole = /^\s*\{\{([\s\S]+?)\}\}\s*$/.exec(raw);
    if (whole) {
      var path = whole[1];
      return function (vals) { return resolve(vals, path); };
    }
    if (raw.indexOf("{{") !== -1) {
      var parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
      return function (vals) {
        var s = "";
        for (var i = 0; i < parts.length; i++) {
          if (i & 1) { var v = resolve(vals, parts[i]); s += v == null ? "" : String(v); }
          else s += parts[i];
        }
        return s;
      };
    }
    return function () { return raw; };
  }

  var SKIP_ATTR = { "data-dc-tpl": 1, "sc-name": 1 };
  var cidSeq = 0;

  function compileChildren(node) {
    var out = [];
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var b = compileNode(kids[i]);
      if (b) out.push(b);
    }
    return out;
  }

  function renderKids(builders, vals, kp) {
    var out = [];
    for (var i = 0; i < builders.length; i++) {
      var r = builders[i](vals, kp);
      if (r == null || r === false || r === true) continue;
      if (Array.isArray(r)) {
        for (var j = 0; j < r.length; j++) {
          var x = r[j];
          if (x != null && x !== false && x !== true) out.push(x);
        }
      } else out.push(r);
    }
    return out;
  }

  function compileNode(node) {
    if (node.nodeType === 3) return compileText(node);         // TEXT_NODE
    if (node.nodeType !== 1) return null;                       // ignore comments etc.
    var tag = node.tagName.toLowerCase();
    if (tag === "sc-for") return compileFor(node);
    if (tag === "sc-if") return compileIf(node);
    return compileElement(node);
  }

  function compileText(node) {
    var txt = node.nodeValue || "";
    var cid = "t" + cidSeq++;
    var b;
    if (txt.indexOf("{{") === -1) {
      // Match the design runtime: drop pure-whitespace nodes that carry no
      // space (bare newlines/tabs); keep everything else verbatim.
      if (!txt.trim() && txt.indexOf(" ") === -1) return null;
      b = function (vals, kp) { return { tx: txt, key: kp + cid }; };
      b.static = true; // constant text — never needs re-diffing
      return b;
    }
    var parts = txt.split(/\{\{([\s\S]+?)\}\}/g);
    b = function (vals, kp) {
      var s = "";
      for (var i = 0; i < parts.length; i++) {
        if (i & 1) { var v = resolve(vals, parts[i]); s += (v == null || v === false || v === true) ? "" : String(v); }
        else s += parts[i];
      }
      return { tx: s, key: kp + cid };
    };
    b.static = false;
    return b;
  }

  function compileElement(node) {
    var tag = node.tagName.toLowerCase();
    var cid = "e" + cidSeq++;
    var propGetters = [];
    var keyGetter = null;
    var refGetter = null;
    var dynamicSelf = false; // this element's own attributes/events/ref/key vary
    var attrs = node.attributes;
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name, value = attrs[a].value;
      if (SKIP_ATTR[name] || name.indexOf("hint-") === 0) continue;
      if (name === "key") { keyGetter = compileAttr(value); dynamicSelf = true; continue; }
      if (name === "ref") { refGetter = compileAttr(value); dynamicSelf = true; continue; }
      if (isEvent(name) || value.indexOf("{{") !== -1) dynamicSelf = true;
      propGetters.push([name, compileAttr(value)]);
    }
    var kidBuilders = compileChildren(node);
    // "children static" == every descendant is constant. Such a subtree never
    // needs re-diffing after mount, so on patch we skip its children entirely.
    // This is both an optimization AND what keeps imperative DOM effects (e.g.
    // the audience counters' data-count animation, which swaps its own text
    // node each frame) from being fought by the reconciler re-inserting a stale
    // node — the classic "$0$250" double-render.
    var childrenStatic = true;
    for (var k = 0; k < kidBuilders.length; k++) { if (!kidBuilders[k].static) { childrenStatic = false; break; } }
    var b = function (vals, kp) {
      var props = {};
      for (var i = 0; i < propGetters.length; i++) props[propGetters[i][0]] = propGetters[i][1](vals);
      if (refGetter) props.__ref = refGetter(vals);
      var key = keyGetter ? kp + "k" + String(keyGetter(vals)) : kp + cid;
      var vn = { el: tag, key: key, props: props, kids: renderKids(kidBuilders, vals, kp) };
      if (childrenStatic) vn.leaf = true;
      return vn;
    };
    // A parent may skip reconciling this element only if BOTH it and its
    // subtree are constant.
    b.static = !dynamicSelf && childrenStatic;
    return b;
  }

  function compileFor(node) {
    var listGet = compileAttr(node.getAttribute("list") || "");
    var asName = node.getAttribute("as") || "item";
    var cid = "f" + cidSeq++;
    var kidBuilders = compileChildren(node);
    var b = function (vals, kp) {
      var list = listGet(vals);
      if (!Array.isArray(list)) list = [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var sub = Object.assign({}, vals);
        sub[asName] = list[i];
        sub.$index = i;
        var childKp = kp + cid + ":" + i + "/";
        var rendered = renderKids(kidBuilders, sub, childKp);
        for (var j = 0; j < rendered.length; j++) out.push(rendered[j]);
      }
      return out;
    };
    b.static = false;
    return b;
  }

  function compileIf(node) {
    var valGet = compileAttr(node.getAttribute("value") || "");
    var kidBuilders = compileChildren(node);
    var b = function (vals, kp) {
      return valGet(vals) ? renderKids(kidBuilders, vals, kp) : null;
    };
    b.static = false;
    return b;
  }

  /* ── reconciler ──────────────────────────────────────────────────────────
     Keyed diff. Reused nodes are patched in place (never recreated), so a
     focused <input> keeps focus + caret and a running CSS animation is not
     disturbed. A changed key (or a node appearing via <sc-if>) creates a fresh
     element, which replays its mount animation — matching React's semantics. */
  function isText(v) { return "tx" in v; }
  function sameType(a, b) { return isText(a) === isText(b) && (isText(a) || a.el === b.el); }

  function isEvent(k) { return k.length > 2 && k[0] === "o" && k[1] === "n" && k.charCodeAt(2) >= 97; }

  function eventType(dom, k) {
    var n = k.slice(2);
    if (n === "change") {
      var tag = dom.tagName;
      var ty = dom.getAttribute ? dom.getAttribute("type") : null;
      if (tag === "SELECT") return "change";
      if (tag === "INPUT" && (ty === "file" || ty === "checkbox" || ty === "radio")) return "change";
      return "input"; // React's onChange fires on input for text/number fields
    }
    return n;
  }

  function ensureDispatcher(dom, type) {
    if (!dom.__evt) dom.__evt = {};
    if (dom.__evt[type]) return;
    dom.__evt[type] = true;
    dom.addEventListener(type, function (e) {
      var h = dom.__h && dom.__h[type];
      if (typeof h === "function") h(e);
    });
  }

  function setProp(dom, k, nv) {
    if (isEvent(k)) {
      var type = eventType(dom, k);
      ensureDispatcher(dom, type);
      (dom.__h || (dom.__h = {}))[type] = typeof nv === "function" ? nv : null;
      return;
    }
    if (k === "class") { dom.className = nv == null ? "" : nv; return; }
    if (k === "value") { var v = nv == null ? "" : nv; if (dom.value !== String(v)) dom.value = v; return; }
    if (k === "checked") { dom.checked = !!nv; return; }
    if (k === "disabled") { dom.disabled = !!nv; return; }
    if (k === "style") { var s = nv == null ? "" : String(nv); if (dom.getAttribute("style") !== s) dom.setAttribute("style", s); return; }
    if (nv === false || nv == null) dom.removeAttribute(k);
    else if (nv === true) dom.setAttribute(k, "");
    else if (String(nv) !== dom.getAttribute(k)) dom.setAttribute(k, String(nv));
  }

  function removeProp(dom, k) {
    if (isEvent(k)) { if (dom.__h) dom.__h[eventType(dom, k)] = null; return; }
    if (k === "class") { dom.className = ""; return; }
    if (k === "value") { dom.value = ""; return; }
    if (k === "checked") { dom.checked = false; return; }
    if (k === "disabled") { dom.disabled = false; return; }
    if (k === "style") { dom.removeAttribute("style"); return; }
    dom.removeAttribute(k);
  }

  function updateProps(dom, oldP, newP) {
    oldP = oldP || {}; newP = newP || {};
    for (var k in oldP) { if (k === "__ref" || k === "key") continue; if (!(k in newP)) removeProp(dom, k); }
    for (var n in newP) {
      if (n === "__ref" || n === "key") continue;
      if (isEvent(n) || newP[n] !== oldP[n]) setProp(dom, n, newP[n]);
    }
  }

  function callRef(fn, val) { if (typeof fn === "function") { try { fn(val); } catch (e) { console.error(e); } } }

  function createDom(v) {
    if (isText(v)) { var t = document.createTextNode(v.tx); v.dom = t; return t; }
    var el = document.createElement(v.el);
    v.dom = el;
    updateProps(el, null, v.props);
    for (var i = 0; i < v.kids.length; i++) el.appendChild(createDom(v.kids[i]));
    if (v.el === 'select' && v.props.value != null) setProp(el, 'value', v.props.value);
    if (v.props.__ref) callRef(v.props.__ref, el);
    return el;
  }

  function patchVnode(old, nw) {
    if (isText(nw)) { nw.dom = old.dom; if (old.tx !== nw.tx) old.dom.nodeValue = nw.tx; return; }
    nw.dom = old.dom;
    updateProps(old.dom, old.props, nw.props);
    // Leaf == fully-static children: built once at mount, never re-diffed. This
    // leaves imperatively-managed content (e.g. animated counters) untouched.
    if (!nw.leaf) patchChildren(old.dom, old.kids, nw.kids);
    if (nw.el === 'select' && nw.props.value != null) setProp(old.dom, 'value', nw.props.value);
  }

  function unmountRefs(v) {
    if (isText(v)) return;
    if (v.props && v.props.__ref) callRef(v.props.__ref, null);
    for (var i = 0; i < v.kids.length; i++) unmountRefs(v.kids[i]);
  }

  function patchChildren(parent, oldK, newK) {
    var byKey = null;
    if (oldK.length) { byKey = new Map(); for (var o = 0; o < oldK.length; o++) byKey.set(oldK[o].key, oldK[o]); }
    var used = byKey ? new Set() : null;
    var doms = [];
    for (var i = 0; i < newK.length; i++) {
      var nv = newK[i];
      var ov = byKey ? byKey.get(nv.key) : undefined;
      if (ov && sameType(ov, nv)) { patchVnode(ov, nv); used.add(nv.key); }
      else createDom(nv);
      doms.push(nv.dom);
    }
    if (byKey) for (var r = 0; r < oldK.length; r++) {
      var ok = oldK[r];
      if (!used.has(ok.key)) { unmountRefs(ok); if (ok.dom && ok.dom.parentNode) ok.dom.parentNode.removeChild(ok.dom); }
    }
    var prev = null;
    for (var d = 0; d < doms.length; d++) {
      var dom = doms[d];
      var target = prev ? prev.nextSibling : parent.firstChild;
      if (target !== dom) parent.insertBefore(dom, target);
      prev = dom;
    }
  }

  /* ── component base + boot ────────────────────────────────────────────────
     DCLogic is the same shape the prototype's logic classes were written
     against, so those classes are reused unchanged. */
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (update, cb) {
    var patch = typeof update === "function" ? update(this.state) : update;
    this.state = Object.assign({}, this.state, patch);
    if (this.__schedule) this.__schedule(cb); else if (cb) cb();
  };
  DCLogic.prototype.forceUpdate = function (cb) { if (this.__schedule) this.__schedule(cb); };
  DCLogic.prototype.componentDidMount = function () {};
  DCLogic.prototype.componentDidUpdate = function () {};
  DCLogic.prototype.componentWillUnmount = function () {};
  DCLogic.prototype.renderVals = function () { return {}; };

  function boot(opts) {
    var container = opts.container;
    var props = opts.props || {};
    var rootBuilders = compileChildren(opts.template);
    var logic = new opts.Logic(props);
    logic.props = props;
    var oldTree = [];
    var mounted = false;
    var prevProps = props;
    var queued = false;
    var pendingCbs = [];

    function doRender() {
      var rv = {};
      try { rv = logic.renderVals() || {}; } catch (e) { console.error("renderVals()", e); }
      var vals = Object.assign({}, logic.props, rv);
      var tree = renderKids(rootBuilders, vals, "");
      patchChildren(container, oldTree, tree);
      oldTree = tree;
      if (!mounted) { mounted = true; try { logic.componentDidMount(); } catch (e) { console.error(e); } }
      else { try { logic.componentDidUpdate(prevProps); } catch (e) { console.error(e); } }
      prevProps = logic.props;
    }

    logic.__schedule = function (cb) {
      if (cb) pendingCbs.push(cb);
      if (queued) return;
      queued = true;
      Promise.resolve().then(function () {
        queued = false;
        doRender();
        var cbs = pendingCbs.splice(0);
        for (var i = 0; i < cbs.length; i++) { try { cbs[i] && cbs[i](); } catch (e) { console.error(e); } }
      });
    };

    doRender(); // initial render + componentDidMount
    window.addEventListener("pagehide", function () { try { logic.componentWillUnmount(); } catch (e) {} }, { once: true });
    return logic;
  }

  window.DCX = { DCLogic: DCLogic, boot: boot, resolve: resolve };
})();
