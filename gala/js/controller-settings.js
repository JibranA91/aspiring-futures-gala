(function () {
  const Brand = window.FundraiserBrand;
  const desktop = window.fundraiserDesktop;
  const KEY = 'af-gala-state-v1';
  async function prepare(defaults) {
    if (!desktop) return;
    const loaded = await desktop.load();
    if (loaded.error) throw new Error(loaded.error);
    let cached;
    try { cached = JSON.parse(localStorage.getItem(KEY)); } catch {}
    const recovery = await desktop.recover(cached);
    window.fundraiserRecovered = recovery.recovered || loaded.recovered;
    if (recovery.state) localStorage.setItem(KEY, JSON.stringify(recovery.state));
    else if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify({ ...defaults,
      eventName: 'Our Fundraising Evening', tagline: 'Together, we make a difference', qrCaption: 'Scan to support our work.',
      branding: Brand.defaults, categories: [{ id: 'community', name: 'Community support', pct: 100, monthly: 50, unit: 'people' }], donations: [] }));
  }
  function enhance(Component) {
    const proto = Component.prototype;
    const mount = proto.componentDidMount, unmount = proto.componentWillUnmount, render = proto.renderVals, persist = proto.persist;
    proto.componentDidMount = function () {
      mount.call(this);
      Brand.apply(this.state.s.branding);
      this.setState({ brandDraft: Brand.normalize(this.state.s.branding), brandNote: '', desktopStatus: null, diskState: desktop ? 'saving' : '' });
      if (desktop) {
        if (window.fundraiserRecovered) this.setState({ restoreNote: 'Recovered an event backup. Please review the latest gifts before continuing.' });
        const update = status => this.setState({ desktopStatus: status, code: status.code, live: status.viewers > 0 });
        this.desktopUnsubscribe = desktop.onStatus(update);
        desktop.status().then(update);
        this.desktopPoll = setInterval(() => desktop.status().then(update).catch(() => {}), 2500);
      }
    };
    proto.componentWillUnmount = function () { clearInterval(this.desktopPoll); this.desktopUnsubscribe?.(); unmount.call(this); };
    proto.persist = function (state) {
      persist.call(this, state);
      Brand.apply(state.branding);
      if (!desktop) return;
      const sequence = this.saveSequence = (this.saveSequence || 0) + 1;
      this.setState({ diskState: 'saving' });
      desktop.save(state).then(result => {
        if (sequence !== this.saveSequence) return;
        this.setState({ diskState: 'saved', savedAt: result.savedAt });
      }).catch(error => {
        if (sequence === this.saveSequence) this.setState({ diskState: 'failed', restoreNote: 'File save failed: ' + error.message + ' Keep this app open and export the event.' });
      });
      desktop.csv(this.csvText(state)).catch(error => this.setState({ restoreNote: 'CSV backup could not be saved: ' + error.message }));
    };
    proto.renderVals = function () {
      const result = render.call(this);
      const brand = Brand.normalize(this.state.s?.branding);
      const draft = this.state.brandDraft || brand;
      const status = this.state.desktopStatus || {};
      const update = (key, value) => this.setState({ brandDraft: { ...(this.state.brandDraft || brand), [key]: value }, brandNote: '' });
      const chooseImage = key => async event => {
        try { update(key, await Brand.readImage(event.target.files?.[0])); }
        catch (error) { this.setState({ brandNote: error.message }); }
        event.target.value = '';
      };
      Object.assign(result, {
        organization: brand.organization, logoSrc: brand.logo || 'assets/fundraising-mark.svg', logoVisible: !!brand.logo,
        brandOrganization: draft.organization, onBrandOrganization: e => update('organization', e.target.value),
        brandPrimary: draft.primary, onBrandPrimary: e => update('primary', e.target.value),
        brandAccent: draft.accent, onBrandAccent: e => update('accent', e.target.value),
        brandBackground: draft.background, onBrandBackground: e => update('background', e.target.value),
        brandMessage: draft.message, onBrandMessage: e => update('message', e.target.value),
        brandDonationUrl: draft.donationUrl, onBrandDonationUrl: e => update('donationUrl', e.target.value),
        brandCurrency: draft.currency, onBrandCurrency: e => update('currency', e.target.value),
        brandFont: draft.font, onBrandFont: e => update('font', e.target.value),
        brandImpact: draft.showImpact, onBrandImpact: e => update('showImpact', e.target.checked),
        brandLogo: draft.logo || 'assets/fundraising-mark.svg', onBrandLogo: chooseImage('logo'), onBrandQR: chooseImage('qrImage'),
        removeLogo: () => update('logo', ''), removeQR: () => update('qrImage', ''), brandHasQR: !!draft.qrImage,
        brandPreviewText: Brand.foreground(draft.background), brandPreviewFont: Brand.fonts[draft.font][0],
        brandPreviewAmount: Brand.money(10000, draft.currency), brandNote: this.state.brandNote,
        brandContrast: Brand.contrast(draft.primary, draft.background) < 3 || Brand.contrast(draft.accent, draft.background) < 3
          ? 'Low contrast: these colors may be hard to read on a projector.' : 'Colors have good contrast for large display text.',
        brandPresets: Object.entries(Brand.presets).map(([name, colors]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1),
          pick: () => this.setState({ brandDraft: { ...draft, ...colors }, brandNote: '' }) })),
        applyBrand: () => {
          this.commit({ branding: Brand.normalize(draft) });
          this.setState({ brandNote: 'Appearance applied to the controller and audience.' });
        },
        discardBrand: () => this.setState({ brandDraft: brand, brandNote: 'Unapplied changes discarded.' }),
        defaultBrand: () => this.setState({ brandDraft: { ...draft, ...Brand.presets.midnight, font: 'modern' }, brandNote: 'Default colors restored in preview. Click Apply to use them.' }),
        isDesktop: !!desktop, browserOnly: !desktop,
        serverLabel: status.server === 'running' ? 'Server running · port 8080' : status.server === 'starting' ? 'Starting server…' : 'Server stopped',
        serverError: status.error || '', viewerLabel: (status.viewers || 0) + ' projector connections',
        projectorUrls: (status.urls || []).map(url => ({ url })), noNetwork: !(status.urls || []).length,
        restartServer: async () => { try { await desktop.restart(); } catch (e) { this.setState({ restoreNote: e.message }); } },
        saveDiagnostic: () => desktop.diagnostics(), openData: () => desktop.openData(), retrySave: () => this.persist(this.state.s),
        exportEvent: async () => {
          if (desktop) {
            try { await desktop.exportEvent(this.state.s); }
            catch (error) { this.setState({ restoreNote: error.message }); }
            return;
          }
          const url = URL.createObjectURL(new Blob([JSON.stringify(this.state.s)], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url; link.download = 'fundraising-event.json'; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        importEvent: async () => {
          try { const state = await desktop.importEvent(); if (state) { this.commit(state); this.setState({ goalDraft: state.goal, brandDraft: Brand.normalize(state.branding), restoreNote: 'Event imported. Your previous event was archived.' }); } }
          catch (error) { this.setState({ restoreNote: error.message }); }
        }
      });
      if (desktop) Object.assign(result, {
        statusLabel: status.server !== 'running' ? 'Projector server needs attention' : status.viewers > 0 ? 'Audience screen live' : 'Waiting for the projector',
        savedLabel: this.state.diskState === 'saved' ? 'Saved to event file' : this.state.diskState === 'failed' ? 'Save failed — export a backup' : 'Saving event file…',
        showBackupBtn: false, hasBackup: false, backupStatus: this.state.diskState === 'failed' ? 'File save failed — export a backup' : this.state.diskState === 'saved' ? 'Automatic file backup is on' : 'Saving event file…',
        backupLine: 'The event and donations.csv save automatically on this laptop. Use Export event to move all gifts and branding to another laptop.',
        brokerLabel: 'Direct local Wi-Fi connection — no internet needed',
        copyLink: async () => { const url = await desktop.copyLink(); this.setState({ copied: Date.now(), restoreNote: url ? 'Projector link copied: ' + url : 'No local network address found. Connect to Wi-Fi first.' }); },
        newCode: async () => { const code = await desktop.newCode(); this.setState({ code }); },
        openDisplay: () => desktop.openAudience()
      });
      return result;
    };
  }
  window.FundraiserSettings = { prepare, enhance };
})();
