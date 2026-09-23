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
