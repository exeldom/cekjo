const search = document.getElementById('catalog-search');
if (search) {
  search.addEventListener('input', () => {
    let found = 0;
    document.querySelectorAll('[data-name]').forEach(row => {
      row.hidden = !row.dataset.name.includes(search.value.toLowerCase().trim());
      if (!row.hidden) found++;
    });
    document.getElementById('no-results').hidden = found > 0 || !search.value;
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); search.focus(); }
  });
}
document.querySelectorAll('[data-check]').forEach(button => button.addEventListener('click', () => {
  const form = button.closest('form');
  [...form.elements].filter(el => el.type === 'checkbox' && el.name === button.dataset.check).forEach(el => el.checked = button.dataset.value === 'yes');
  if (form.id === 'live-filters') form.dispatchEvent(new Event('change', { bubbles: true }));
}));
document.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => {
  const row = button.closest('tr');
  if (button.dataset.move === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
  if (button.dataset.move === 'down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
}));
document.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => {
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) { event.preventDefault(); return; }
  if (form.enctype === 'multipart/form-data') {
    const button = form.querySelector('button:not([type="button"])');
    if (button) { button.disabled = true; button.classList.add('is-loading'); button.setAttribute('aria-label', 'Mengunggah'); }
  }
}));
document.addEventListener('click', event => document.querySelectorAll('details[open]').forEach(details => {
  if (!details.contains(event.target)) details.open = false;
}));

// Search and filters update the server-paginated results without losing focus.
const liveForm = document.getElementById('live-filters');
if (liveForm) {
  let timer, controller, revision = 0;
  const status = document.getElementById('search-status');
  const refreshCounts = () => liveForm.querySelectorAll('.filter').forEach(filter => {
    const boxes = [...filter.querySelectorAll('input[type="checkbox"]')];
    filter.querySelector('summary small').textContent = `${boxes.filter(x => x.checked).length}/${boxes.length}`;
  });
  const invalidate = () => {
    clearTimeout(timer);
    if (controller) controller.abort();
    revision++;
  };
  const resultsURL = () => {
    const url = new URL(location.pathname, location.origin);
    url.search = new URLSearchParams(new FormData(liveForm)).toString();
    return url;
  };
  const update = async (url, version) => {
    controller = new AbortController();
    const panel = document.getElementById('table-results');
    panel.setAttribute('aria-busy', 'true');
    status.hidden = true;
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Request failed');
      const html = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (version !== revision) return;
      const next = html.getElementById('table-results');
      if (!next) throw new Error('Missing results');
      panel.replaceWith(next);
      history.replaceState(null, '', url);
    } catch (error) {
      if (error.name !== 'AbortError' && version === revision) {
        status.textContent = 'Pencarian gagal. Coba ketik ulang.';
        status.hidden = false;
      }
    } finally {
      if (version === revision) document.getElementById('table-results').removeAttribute('aria-busy');
    }
  };
  const schedule = (delay) => {
    invalidate();
    refreshCounts();
    const version = revision;
    timer = setTimeout(() => update(resultsURL(), version), delay);
  };
  liveForm.elements.q.addEventListener('input', event => { if (!event.isComposing) schedule(250); });
  liveForm.elements.q.addEventListener('compositionend', () => schedule(250));
  liveForm.addEventListener('change', () => schedule(100));
  liveForm.addEventListener('submit', event => { event.preventDefault(); schedule(0); });
  document.addEventListener('click', event => {
    const header = event.target.closest('[data-sort]');
    if (header) {
      liveForm.elements.direction.value = liveForm.elements.sort.value === header.dataset.sort && liveForm.elements.direction.value === 'asc' ? 'desc' : 'asc';
      liveForm.elements.sort.value = header.dataset.sort;
      schedule(0);
      return;
    }
    const link = event.target.closest('#table-results .pagination a');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); invalidate(); update(new URL(link.href), revision);
  });
}
