(function () {
  const $ = (sel) => document.querySelector(sel);
  const form = $("#intake-form");
  const email = $("#email");
  const company = $("#company");
  const vendors = $("#vendors");
  const budget = $("#budget");
  const notes = $("#notes");
  const btn = $("#submitBtn");
  const note = $("#submitNote");
  const ok = $("#flash-ok");
  const err = $("#flash-err");

  // modal elements
  const modal = document.querySelector("#intake-modal");
  const modalTitle = document.querySelector("#intake-modal-title");
  const modalBody = document.querySelector("#intake-modal-body");
  const modalClose = document.querySelector("#intake-modal-close");

  function show(el) {
    if (!el) return;
    el.style.display = "block";
  }
  function hide(el) {
    if (!el) return;
    el.style.display = "none";
  }
  function setErr(el, msg) {
    if (!el) return;
    el.textContent = msg;
    show(el);
  }
  function clearErrs() {
    document.querySelectorAll("#intake-app .err").forEach(function (el) {
      hide(el);
    });
    hide(ok);
    hide(err);
    if (note) note.textContent = "";
  }

  function parseVendors(text) {
    return text
      .split(/[\n,]+/)
      .map(function (s) { return s.trim().toLowerCase(); })
      .filter(Boolean)
      .filter(function (x) {
        return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(x);
      })
      .slice(0, 200);
  }

  function validate() {
    clearErrs();
    var valid = true;
    if (!email.value.trim()) {
      setErr(document.querySelector("#err-email"), "Please enter your email.");
      valid = false;
    }
    if (!company.value.trim()) {
      setErr(document.querySelector("#err-company"), "Please enter your company name.");
      valid = false;
    }
    var list = parseVendors(vendors.value);
    if (list.length === 0) {
      setErr(document.querySelector("#err-vendors"), "Please provide at least one vendor domain.");
      valid = false;
    }
    if (!budget.value) {
      setErr(document.querySelector("#err-budget"), "Please choose a budget.");
      valid = false;
    }
    return { valid: valid, list: list };
  }

  function workerURL() {
    var m = document.querySelector('meta[name="worker-url"]');
    return m && m.content ? m.content.replace(/\/$/, "") : "";
  }

  // modal helpers
  function openModal(title, message) {
    if (!modal) {
      // fallback: avoid silent failure
      if (typeof alert === "function") {
        alert(title + "\n\n" + message);
      }
      return;
    }
    if (modalTitle) modalTitle.textContent = title;
    if (modalBody) modalBody.textContent = message;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  if (modalClose) {
    modalClose.addEventListener("click", function () {
      closeModal();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeModal();
    }
  });

  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var r = validate();
    if (!r.valid) return;
    var list = r.list;

    btn.disabled = true;
    btn.textContent = "Submitting…";
    if (note) note.textContent = "";
    hide(ok);
    hide(err);

    var url = workerURL() ? workerURL() + "/intake" : "/intake";
    var payload = {
      email: email.value.trim(),
      company: company.value.trim(),
      vendors: list,
      budget: budget.value,
      notes: notes.value.trim(),
      path: location.pathname,
      ua: navigator.userAgent,
      ts: new Date().toISOString()
    };

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      mode: "cors",
      credentials: "omit"
    })
      .then(function (res) {
        if (res.ok) {
          show(ok);
          hide(err);
          form.reset();
          if (note) note.textContent = "Preferences saved.";
          openModal(
            "Thanks — your vendor list has been updated.",
            "We’ll use this updated vendor list for future CG Alert digests."
          );
        } else {
          show(err);
          hide(ok);
          if (note) {
            note.textContent =
              "Submission failed. Please try again, or email ops@cg-alert.com if it keeps happening.";
          }
          openModal(
            "Submission failed",
            "Please try again, or email ops@cg-alert.com if it keeps happening."
          );
        }
      })
      .catch(function () {
        show(err);
        hide(ok);
        if (note) {
          note.textContent =
            "Network error. Please try again, or email ops@cg-alert.com if it keeps happening.";
        }
        openModal(
          "Network error",
          "Please try again, or email ops@cg-alert.com if it keeps happening."
        );
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Submit";
      });
  });
})();