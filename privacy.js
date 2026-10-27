// Keep the retention period on this page in sync with the server setting.
fetch('/api/rules')
  .then((r) => r.json())
  .then((d) => { if (d.retentionDays) document.getElementById('retention').textContent = d.retentionDays; })
  .catch(() => {});
