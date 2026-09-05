/* Gala link — transport between the recording laptop and the projector laptop.
   Two modes:
     local  — both windows on one machine (BroadcastChannel)
     paired — two machines over the internet, via a public MQTT-over-WebSocket
              broker. A 4-digit code drives both ends: it derives the room
              (topic) and an AES-GCM key, so the broker only ever carries
              ciphertext. Both ends pick the same broker from the code, and a
              dropped connection reconnects to that SAME broker so the pairing
              survives blips. State is published retained, so a projector that
              reloads gets the current board immediately.
   Payload shapes: {kind:'state'|'presence'|'hello', body:...}
*/
(function () {
  const BROKERS = [
    { url: 'wss://broker.emqx.io:8084/mqtt', name: 'EMQX' },
    { url: 'wss://broker.hivemq.com:8884/mqtt', name: 'HiveMQ' },
    { url: 'wss://test.mosquitto.org:8081/mqtt', name: 'Mosquitto' }
  ];
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const CODE_LEN = 4;
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function newCode() {
    let s = '';
    for (let i = 0; i < CODE_LEN; i++) s += Math.floor(Math.random() * 10);
    return s;
  }
  function parseCode(code) {
    const c = String(code || '').replace(/\D/g, '').slice(0, CODE_LEN);
    if (c.length !== CODE_LEN) return null;
    // The 4-digit code derives both the room (a stable topic) and the key.
    return { room: 'r' + hashStr(c), secret: c, code: c };
  }
  function format(code) {
    return String(code || '').replace(/\D/g, '').slice(0, CODE_LEN);
  }
  function brokerIndexFor(room) {
    let h = 0;
    for (let i = 0; i < room.length; i++) h = (h * 31 + room.charCodeAt(i)) | 0;
    return Math.abs(h) % BROKERS.length;
  }

  function b64(buf) {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  async function keyFor(secret) {
    const h = await crypto.subtle.digest('SHA-256', enc.encode('af-gala:' + secret));
    return crypto.subtle.importKey('raw', h, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return JSON.stringify({ v: 1, iv: b64(iv), d: b64(ct) });
  }
  async function unseal(key, txt) {
    const p = JSON.parse(txt);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.d));
    return JSON.parse(dec.decode(pt));
  }

  function create(opts) {
    const o = opts || {};
    const onMessage = o.onMessage || function () {};
    const onStatus = o.onStatus || function () {};
    const role = o.role || 'display';

    const L = {
      mode: 'local',
      code: '',
      broker: 'off',        // off | connecting | connected | failed
      brokerName: '',
      lastError: '',
      _bi: 0,
      _client: null,
      _key: null,
      _room: '',
      _dead: false
    };

    function status() {
      onStatus({ mode: L.mode, code: L.code, broker: L.broker, brokerName: L.brokerName, lastError: L.lastError });
    }

    // ---- local transport (same machine) ----
    try {
      L._ch = new BroadcastChannel('af-gala-2026');
      L._ch.onmessage = (e) => {
        const m = e.data;
        if (m && m.kind) onMessage(m.kind, m.body, 'local');
      };
    } catch (e) { L._ch = null; }

    // ---- paired transport ----
    function dropClient() {
      const c = L._client;
      L._client = null;
      if (c) { try { c.end(true); } catch (e) {} }
    }

    function connectBroker() {
      if (L._dead || L.mode !== 'paired' || !L._room) return;
      if (typeof mqtt === 'undefined') {
        L.broker = 'failed';
        L.lastError = 'Relay library did not load — check the internet connection.';
        status();
        setTimeout(connectBroker, 4000);
        return;
      }
      const b = BROKERS[L._bi % BROKERS.length];
      L.broker = 'connecting';
      L.brokerName = b.name;
      status();

      let client;
      let connected = false;
      try {
        client = mqtt.connect(b.url, {
          clientId: 'afg_' + role + '_' + Math.random().toString(16).slice(2, 10),
          keepalive: 20, reconnectPeriod: 0, connectTimeout: 8000, clean: true
        });
      } catch (e) {
        L._bi++; setTimeout(connectBroker, 1200); return;
      }
      L._client = client;

      const topicState = 'afgala/' + L._room + '/state';
      const topicPresence = 'afgala/' + L._room + '/presence';

      client.on('connect', () => {
        if (L._client !== client) { try { client.end(true); } catch (e) {} return; }
        connected = true;
        L.broker = 'connected';
        L.lastError = '';
        status();
        client.subscribe([topicState, topicPresence], { qos: 1 });
        pub('presence', { role, t: Date.now() });
        if (role === 'display') pub('hello', { role, t: Date.now() });
      });

      client.on('message', async (topic, payload) => {
        try {
          const obj = await unseal(L._key, payload.toString());
          if (!obj || !obj.kind) return;
          if (obj.from === role && obj.kind === 'presence') return;
          onMessage(obj.kind, obj.body, 'paired');
        } catch (e) { /* not ours, or wrong code */ }
      });

      const fail = (msg) => {
        if (L._client !== client) return;
        L.broker = 'connecting';
        if (msg) L.lastError = msg;
        status();
        dropClient();
        // Reconnect to the SAME broker after a transient drop so we stay paired
        // with the other laptop; only advance to the next broker if we never
        // managed to connect (that broker is down).
        if (!connected) L._bi++;
        setTimeout(connectBroker, connected ? 1200 : 1500);
      };
      client.on('error', (e) => fail(e && e.message ? e.message : 'relay error'));
      client.on('close', () => fail(''));
      client.on('offline', () => fail(''));
    }

    async function pub(kind, body) {
      if (L.mode !== 'paired' || !L._client || L.broker !== 'connected' || !L._key) return;
      const retain = kind === 'state';
      try {
        const txt = await seal(L._key, { kind, body, from: role });
        L._client.publish('afgala/' + L._room + '/' + (retain ? 'state' : 'presence'), txt, { qos: retain ? 1 : 0, retain });
      } catch (e) {}
    }

    L.send = function (kind, body) {
      if (L._ch) { try { L._ch.postMessage({ kind, body, from: role }); } catch (e) {} }
      pub(kind, body);
    };

    L.setMode = async function (mode, code) {
      L.mode = mode === 'paired' ? 'paired' : 'local';
      dropClient();
      if (L.mode === 'paired') {
        const p = parseCode(code);
        if (!p) { L.mode = 'local'; L.code = ''; L.broker = 'off'; status(); return false; }
        L.code = p.code;
        L._room = p.room;
        L._key = await keyFor(p.secret);
        L._bi = brokerIndexFor(p.room);
        connectBroker();
      } else {
        L.code = '';
        L.broker = 'off';
        L.brokerName = '';
        status();
      }
      return true;
    };

    L.destroy = function () {
      L._dead = true;
      dropClient();
      if (L._ch) { try { L._ch.close(); } catch (e) {} }
    };

    return L;
  }

  window.GalaLink = { create, newCode, parseCode, format };
})();
