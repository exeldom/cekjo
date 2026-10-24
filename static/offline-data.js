(() => {
  // Remove table snapshots left by older versions of the PWA.
  async function clear() {
    if ('caches' in window) await Promise.all(['cekjo-data-v1','cekjo-data-v2'].map(name => caches.delete(name)));
  }
  clear().catch(() => {});
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('cekjo-data') : null;
  channel?.addEventListener('message', event => {
    if (event.data === 'logout') { clear().catch(() => {}); location.replace('/login'); }
  });
  document.querySelectorAll('form[action="/logout"]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    await clear().catch(() => {});
    channel?.postMessage('logout');
    HTMLFormElement.prototype.submit.call(form);
  }));
})();
