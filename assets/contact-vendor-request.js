(function () {
  var form = document.getElementById('vendor-request-form');
  if (!form) return;

  var params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (_) {
    params = null;
  }
  var vendorFromQuery = params ? (params.get('vendor') || '') : '';
  var vendorInput = document.getElementById('vendor-input');
  if (vendorFromQuery && vendorInput && !vendorInput.value) {
    vendorInput.value = vendorFromQuery;
  }

  var statusEl = document.getElementById('vendor-request-status');
  var workerMeta = document.querySelector('meta[name="worker-url"]');
  var workerUrl = workerMeta ? workerMeta.content : '';

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!workerUrl) {
      if (statusEl) {
        statusEl.textContent = 'Request recorded. You can also email ops@cg-alert.com with additional details.';
        statusEl.style.display = '';
      }
      form.reset();
      return;
    }
    var fd = new FormData(form);
    var payload = {
      email: fd.get('email') || '',
      vendor: fd.get('vendor') || vendorFromQuery || '',
      notes: fd.get('notes') || '',
      source: 'contact_form',
      path: window.location.pathname + window.location.search,
      ts: new Date().toISOString()
    };
    var endpoint = workerUrl.replace(/\/$/, '') + '/vendor-request';
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit'
    })
    .then(function (res) {
      if (!res.ok) throw new Error('bad status');
      return res.json().catch(function () { return {}; });
    })
    .then(function () {
      if (statusEl) {
        statusEl.textContent = 'Thanks, we\'ve received your request and will prioritize it.';
        statusEl.style.display = '';
      }
      form.reset();
    })
    .catch(function () {
      if (statusEl) {
        statusEl.textContent = 'Request failed over the API; you can email ops@cg-alert.com and include your vendor.';
        statusEl.style.display = '';
      }
    });
  });
})();
