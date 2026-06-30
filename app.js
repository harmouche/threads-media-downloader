import {
  buildProxyUrl,
  downloadVariant,
  resolvePostViaApi,
  saveBlob,
} from './lib/threads-downloader.esm.js';

const $ = (id) => document.getElementById(id);

let session = null;
let busy = false;
let turnstileWidgetId = null;
let captchaToken = '';
let siteKey = '';

async function loadAppConfig() {
  const cfg = await (window.__appConfigPromise || Promise.resolve({ turnstileSiteKey: '' }));
  siteKey = cfg.turnstileSiteKey || window.TURNSTILE_SITE_KEY || '';
}

function showError(msg) {
  const el = $('error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function setLoading(on) {
  $('loadBtn').disabled = on;
  $('postUrl').disabled = on;
  $('skeleton').style.display = on ? 'block' : 'none';
  $('results').style.display = on ? 'none' : $('results').innerHTML ? 'block' : 'none';
}

function renderTurnstile() {
  if (!siteKey || !window.turnstile) return;
  if (turnstileWidgetId != null) {
    window.turnstile.reset(turnstileWidgetId);
    return;
  }
  turnstileWidgetId = window.turnstile.render($('turnstile'), {
    sitekey: siteKey,
    theme: 'dark',
    callback: (token) => { captchaToken = token; },
    'expired-callback': () => { captchaToken = ''; },
  });
}

function variantLabel(v) {
  const hd = (v.width || 0) * (v.height || 0) >= 921600 ? ' HD' : '';
  const type = v.content_type.includes('video') ? 'MP4' : 'JPEG';
  return `${type} ${v.resolution}${hd}`;
}

function renderResults(data) {
  const root = $('results');
  root.innerHTML = '';
  let idx = 0;

  function addCard(kind, group) {
    idx += 1;
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('h3');
    title.textContent = `${kind} ${idx}`;
    card.appendChild(title);

    if (group.thumbnail) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = group.thumbnail;
      img.alt = '';
      img.referrerPolicy = 'no-referrer-when-downgrade';
      card.appendChild(img);
    }

    const btns = document.createElement('div');
    for (const v of group.variants) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn sm secondary';
      b.textContent = `Download ${variantLabel(v)}`;
      b.onclick = () => startDownload(v);
      btns.appendChild(b);

      const linkRow = document.createElement('div');
      linkRow.className = 'link-row';
      const a = document.createElement('a');
      a.href = v.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Open raw link';
      linkRow.appendChild(a);
      btns.appendChild(linkRow);
    }
    card.appendChild(btns);
    root.appendChild(card);
  }

  for (const g of data.media.videos) addCard('Video', g);
  for (const g of data.media.images) addCard('Image', g);

  root.style.display = root.children.length ? 'block' : 'none';
}

async function startDownload(variant) {
  if (!session?.proxy_auth || busy) return;
  busy = true;
  const modal = $('dlModal');
  modal.classList.add('open');
  $('dlBar').style.width = '0%';
  $('dlLabel').textContent = 'Do not close this tab';

  try {
    const { blob, filename } = await downloadVariant(variant, {
      proxy_auth: session.proxy_auth,
      onProgress: (pct, label) => {
        $('dlBar').style.width = pct + '%';
        if (label) $('dlLabel').textContent = label;
      },
    });
    if (blob.size > 5000) await saveBlob(blob, filename);
    $('dlTitle').textContent = 'Done';
  } catch (e) {
    $('dlTitle').textContent = 'Download failed';
    $('dlLabel').textContent = e.message || 'Try Open raw link';
  } finally {
    setTimeout(() => {
      modal.classList.remove('open');
      busy = false;
    }, 800);
  }
}

async function loadMedia() {
  if (busy) return;
  const url = $('postUrl').value.trim();
  if (!url) {
    showError('Enter a Threads post URL');
    return;
  }
  if (siteKey && !captchaToken) {
    showError('Complete the captcha first');
    renderTurnstile();
    return;
  }

  busy = true;
  showError('');
  $('postUrl').classList.remove('invalid');
  setLoading(true);
  session = null;

  try {
    const data = await resolvePostViaApi(url, { captchaToken: captchaToken || undefined });
    session = data;
    renderResults(data);
    if (!data.media.videos.length && !data.media.images.length) {
      showError('No media found in this post.');
    }
  } catch (e) {
    showError(e.message || 'Load failed');
    if (/invalid url/i.test(e.message || '')) $('postUrl').classList.add('invalid');
  } finally {
    setLoading(false);
    busy = false;
    if (siteKey) renderTurnstile();
  }
}

$('loadBtn').addEventListener('click', loadMedia);
$('postUrl').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadMedia();
});

loadAppConfig().then(() => {
  if (!siteKey) return;
  const t = setInterval(() => {
    if (window.turnstile) {
      clearInterval(t);
      renderTurnstile();
    }
  }, 200);
});
