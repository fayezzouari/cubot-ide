export const parseDate = (value: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);

export const formatRelative = (value: string) => {
  const diff = Date.now() - parseDate(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return parseDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const formatLastEdit = (value: string) => {
  const date = parseDate(value);
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `today at ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return `on ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
};
