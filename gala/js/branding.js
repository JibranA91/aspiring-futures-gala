(function () {
  const presets = {
    midnight: { primary: '#56d6b3', accent: '#80a7ff', background: '#101923' },
    gala: { primary: '#f2a93b', accent: '#9563dc', background: '#0e0b26' },
    ocean: { primary: '#47c4f1', accent: '#9f8aff', background: '#091e35' },
    paper: { primary: '#205b49', accent: '#7541a3', background: '#faf6ee' }
  };
  const fonts = { rounded: ['Caprasimo', 'Figtree'], classic: ['Georgia', 'Figtree'], modern: ['Figtree', 'Figtree'] };
  const defaults = { ...presets.midnight, organization: 'Your organization', logo: '', font: 'modern', currency: 'USD', showImpact: true,
    message: 'Together, we make a difference', qrImage: '', donationUrl: '' };
  const legacy = { ...defaults, ...presets.gala, organization: 'Aspiring Futures', logo: 'assets/aspiring-futures-logo.jpg', font: 'rounded', message: 'We are sending children back to school' };
  const anonymousTemplate = 'A friend of {organization name}';
  function anonymousName(state = {}) {
    const template = typeof state.anonymousLabel === 'string' && state.anonymousLabel.trim()
      ? state.anonymousLabel.trim().slice(0, 160) : anonymousTemplate;
    const organization = normalize(state.branding).organization.trim() || 'our community';
    return template.replace(/\{organization name\}/gi, () => organization);
  }
  const hex = value => /^#[\da-f]{6}$/i.test(value || '');
  const rgb = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  function mix(a, b, ratio) {
    const x = rgb(a), y = rgb(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * ratio).toString(16).padStart(2, '0')).join('');
  }
  function luminance(color) {
    return rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  function foreground(background) { return contrast(background, '#ffffff') > contrast(background, '#121826') ? '#ffffff' : '#121826'; }
  function validImage(value) { return typeof value === 'string' && value.length <= 1500000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value); }
  function normalize(value, fallback = legacy) {
    const raw = value && typeof value === 'object' ? value : fallback;
    const result = { ...defaults, ...raw };
    for (const key of ['primary', 'accent', 'background']) if (!hex(result[key])) result[key] = defaults[key];
    for (const key of ['organization', 'message']) result[key] = String(result[key] || '').slice(0, key === 'organization' ? 80 : 180);
    result.logo = validImage(result.logo) || result.logo === legacy.logo ? result.logo : '';
    result.qrImage = validImage(result.qrImage) ? result.qrImage : '';
    result.donationUrl = /^https?:\/\//i.test(result.donationUrl || '') ? String(result.donationUrl).slice(0, 1000) : '';
    if (!fonts[result.font]) result.font = defaults.font;
    if (!['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'PKR', 'INR'].includes(result.currency)) result.currency = 'USD';
    result.showImpact = result.showImpact !== false;
    return result;
  }
  let applied;
  function apply(value) {
    const brand = normalize(value);
    const signature = JSON.stringify(brand);
    if (signature === applied || typeof document === 'undefined') return brand;
    applied = signature;
    const style = document.documentElement.style;
    const text = foreground(brand.background);
    const set = (key, value) => style.setProperty(key, value);
    set('--color-bg', brand.background);
    set('--color-surface', mix(brand.background, text, .065));
    set('--color-text', text);
    set('--color-accent', brand.primary);
    set('--color-accent-2', brand.accent);
    set('--color-divider', mix(brand.background, text, .2));
    set('--on-primary', foreground(brand.primary));
    set('--on-accent', foreground(brand.accent));
    set('--theme-glow', mix(brand.background, brand.accent, .55));
    set('--theme-warm-glow', mix(brand.background, brand.primary, .35));
    set('--theme-card', mix(brand.background, brand.accent, .2));
    for (let i = 1; i <= 9; i++) {
      set('--color-neutral-' + i * 100, mix(brand.background, text, (10 - i) / 10));
      for (const [name, color] of [['accent', brand.primary], ['accent-2', brand.accent]]) {
        set('--color-' + name + '-' + i * 100, i <= 5 ? mix(color, text, (5 - i) * .12) : mix(color, brand.background, (i - 5) * .17));
      }
    }
    set('--font-heading', fonts[brand.font][0] + ', Georgia, serif');
    set('--font-body', fonts[brand.font][1] + ', Arial, sans-serif');
    set('--font-heading-weight', brand.font === 'rounded' ? '400' : '700');
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.setAttribute('href', brand.logo || 'assets/fundraising-mark.svg');
    document.title = (location.pathname.includes('audience') ? 'Audience Screen' : 'Gala Control') + ' · ' + brand.organization;
    return brand;
  }
  function money(number, currency = 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(Number(number) || 0));
  }
  async function readImage(file) {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url;
      await image.decode();
      const ratio = Math.min(1, 800 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL('image/png');
      if (!validImage(result)) throw new Error('This image is too detailed. Try a smaller image.');
      return result;
    } finally { URL.revokeObjectURL(url); }
  }
  const api = { defaults, legacy, presets, fonts, normalize, apply, money, contrast, foreground, readImage, validImage, anonymousTemplate, anonymousName };
  if (typeof window !== 'undefined') window.FundraiserBrand = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
