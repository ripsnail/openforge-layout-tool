let container;

function getContainer() {
  if (container?.isConnected) return container;
  container = document.getElementById('notifications');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notifications';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
  }
  return container;
}

export function notify(message, { persistent = false, type = 'error' } = {}) {
  const item = document.createElement('div');
  item.className = `notification notification-${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'notification-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';
  close.addEventListener('click', () => item.remove());
  item.appendChild(close);

  getContainer().appendChild(item);
  if (!persistent) setTimeout(() => item.remove(), 6000);
  return item;
}
