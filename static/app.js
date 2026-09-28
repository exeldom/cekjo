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
document.addEventListener('click', event => {
  const button=event.target.closest('[data-check]');if(!button)return;
  const form=button.closest('form');
  [...form.elements].filter(el=>el.type==='checkbox'&&el.name===button.dataset.check).forEach(el=>el.checked=button.dataset.value==='yes');
  if(form.id==='live-filters'){
    const filter=button.closest('.filter');filter.querySelectorAll('[data-unavailable]').forEach(el=>el.remove());
    filter.querySelector('input[name$="_set"]').disabled=button.dataset.value==='yes';
    form.dispatchEvent(new Event('change',{bubbles:true}));
  }
});
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
    const params=new URLSearchParams(new FormData(liveForm));
    liveForm.querySelectorAll('input[name$="_set"]:disabled').forEach(el=>params.delete(el.name.slice(0,-4)));
    url.search=params.toString();
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
      const menus=html.querySelector('#live-filters .filter-actions');
      if(!menus)throw new Error('Missing filters');
      const current=liveForm.querySelector('.filter-actions');
      const open=[...current.querySelectorAll('details')].map(el=>el.open);
      const scroll=[...current.querySelectorAll('.filter-options')].map(el=>el.scrollTop);
      current.replaceWith(menus);
      menus.querySelectorAll('details').forEach((el,i)=>el.open=open[i]);
      menus.querySelectorAll('.filter-options').forEach((el,i)=>el.scrollTop=scroll[i]||0);
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
  liveForm.addEventListener('change', event => {
    if(event.target.matches('input[type="checkbox"]')){
      const filter=event.target.closest('.filter');
      filter.querySelector('input[name$="_set"]').disabled=false;
    }
    schedule(100);
  });
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
