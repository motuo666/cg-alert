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

  function show(el) {
    el.style.display = "block";
  }
  function hide(el) {
    el.style.display = "none";
  }
  function setErr(el, msg) {
    el.textContent = msg;
    show(el);
  }
  function clearErrs() {
    document.querySelectorAll("#intake-app .err").forEach(hide);
    hide(ok);
    hide(err);
    note.textContent = "";
  }

  function parseVendors(text) {
    return text
      .split(/[\n,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .filter((x) =>
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(x)
      )
      .slice(0, 200);
  }

  function validate() {
    clearErrs();
    let valid = true;
    if (!email.value.trim()) {
      setErr($("#err-email"), "Please enter your email.");
      valid = false;
    }
    if (!company.value.trim()) {
      setErr($("#err-company"), "Please enter your company name.");
      valid = false;
    }
    const list = parseVendors(vendors.value);
    if (list.length === 0) {
      setErr($("#err-vendors"), "Please provide at least one vendor domain.");
      valid = false;
    }
    if (!budget.value) {
      setErr($("#err-budget"), "Please choose a budget.");
      valid = false;
    }
    return { valid, list };
  }

  function workerURL() {
    const m = document.querySelector('meta[name="worker-url"]');
    return m && m.content ? m.content.replace(/\/$/, "") : "";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { valid, list } = validate();
    if (!valid) return;

    btn.disabled = true;
    btn.textContent = "Submitting…";
    note.textContent = "";
    hide(ok);
    hide(err);

    const url = workerURL() ? workerURL() + "/lead" : "/lead";
    const payload = {
      email: email.value.trim(),
      company: company.value.trim(),
      vendors: list,
      budget: budget.value,
      notes: notes.value.trim(),
      path: location.pathname,
      ua: navigator.userAgent,
      ts: new Date().toISOString(),
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "cors",
        credentials: "omit",
      });

      if (res.ok) {
        show(ok);
        hide(err);
        form.reset();
        note.textContent = "Preferences saved.";
        alert("Thanks — your vendor list has been updated.");
      } else {
        show(err);
        hide(ok);
        note.textContent =
          "Submission failed. Please try again, or email ops@cg-alert.com if it keeps happening.";
        alert(
          "Submission failed.\nPlease try again, or email ops@cg-alert.com if it keeps happening."
        );
      }
    } catch (ex) {
      show(err);
      hide(ok);
      note.textContent =
        "Network error. Please try again, or email ops@cg-alert.com if it keeps happening.";
      alert(
        "Network error.\nPlease try again, or email ops@cg-alert.com if it keeps happening."
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit";
    }
  });
})();
