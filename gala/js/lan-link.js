(function () {
  const legacyCreate = window.GalaLink.create;
  window.GalaLink.create = function (options) {
    const desktop = window.fundraiserDesktop;
    const local = legacyCreate(options);
    const localMode = local.setMode.bind(local);
    const localSend = local.send.bind(local);
    const localDestroy = local.destroy.bind(local);
    let stream, timer, dead = false, generation = 0, code = '', mode = 'local';
    const key = 'fundraiser-viewer-token';
    const report = (broker, lastError = '') => options.onStatus?.({ mode, code, broker, brokerName: 'Local Wi-Fi', lastError });
    const disconnect = () => { clearTimeout(timer); if (stream) stream.close(); stream = null; };
    async function connect(version) {
      if (dead || version !== generation) return;
      disconnect();
      report('connecting');
      try {
        let saved;
        try { saved = JSON.parse(sessionStorage.getItem(key)); } catch {}
        let token = saved?.code === code ? saved.token : '';
        if (!token) {
          const response = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(8000) });
          const data = await response.json();
          if (!response.ok) {
            report('failed', data.error || 'Unable to pair.');
            return;
          }
          token = data.token;
          if (dead || version !== generation) return;
          sessionStorage.setItem(key, JSON.stringify({ code, token }));
        }
        if (dead || version !== generation) return;
        stream = new EventSource('/api/events?token=' + encodeURIComponent(token));
        stream.onopen = () => report('connected');
        stream.onmessage = event => {
          try { const message = JSON.parse(event.data); options.onMessage(message.kind, message.body, 'paired'); } catch {}
        };
        stream.onerror = () => {
          disconnect();
          report('connecting', 'Reconnecting to the controller…');
          // Keep the saved token during outages; a new code can always pair afresh.
          timer = setTimeout(async () => {
            try {
              const response = await fetch('/api/session?token=' + encodeURIComponent(token), { signal: AbortSignal.timeout(4000) });
              if (response.status === 401) sessionStorage.removeItem(key);
            } catch {}
            connect(version);
          }, 2000);
        };
      } catch {
        report('connecting', 'Waiting for the controller. Keep this screen open.');
        if (!dead && version === generation) timer = setTimeout(() => connect(version), 2000);
      }
    }
    local.setMode = async function (next, value) {
      generation++;
      disconnect();
      mode = next;
      code = value || '';
      await localMode('local', '');
      if (mode !== 'paired') return true;
      if (desktop) { report('connected'); return true; }
      if (!window.FundraiserLAN) { report('failed', 'Open the projector link shown in the portable app.'); return false; }
      if (!window.GalaLink.parseCode(code)) { report('failed', 'Enter the four-digit code.'); return false; }
      connect(generation);
      return true;
    };
    local.send = function (kind, body) {
      localSend(kind, body);
      if (desktop && kind === 'celebrate') desktop.celebrate(body.type).catch(() => {});
    };
    local.destroy = function () { dead = true; generation++; disconnect(); localDestroy(); };
    return local;
  };
})();
