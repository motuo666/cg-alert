(function() {
  try {
    var params = new URLSearchParams(window.location.search);
    var q = (params.get('q') || '').trim();
    var input = document.getElementById('vendor-query');
    if (input && q) {
      input.value = q;
    }
    if (!q) return;
    var rows = document.querySelectorAll('[data-vendor-row]');
    var any = false;
    var qLower = q.toLowerCase();
    rows.forEach(function(row) {
      var text = (row.getAttribute('data-vendor') || '') + ' ' + (row.getAttribute('data-path') || '');
      if (text.toLowerCase().indexOf(qLower) !== -1) {
        row.style.display = '';
        any = true;
      } else {
        row.style.display = 'none';
      }
    });
    var empty = document.getElementById('vendor-empty');
    if (empty) {
      if (!any) {
        empty.style.display = '';
        try {
          var nameSpan = document.getElementById('vendor-empty-name');
          if (nameSpan && q) {
            nameSpan.textContent = q;
          }
          var cta = document.getElementById('vendor-empty-cta');
          if (cta && q && window.URL) {
            try {
              var baseHref = cta.getAttribute('href') || '/contact/';
              var url = new URL(baseHref, window.location.origin);
              url.searchParams.set('vendor', q);
              cta.setAttribute('href', url.pathname + url.search);
            } catch (_) {
              // ignore URL construction errors
            }
          }
        } catch (_) {
          // ignore personalization errors
        }
      } else {
        empty.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('vendor search error', e);
  }
})();
