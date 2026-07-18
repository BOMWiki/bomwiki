// Drives the model upload page: two-step flow against the API — POST the raw
// file bytes to /api/models/upload, then POST the metadata (license,
// attribution, attestation) to /api/models/submit.
(() => {
  const form = document.getElementById('bw-mu-form');
  const dataEl = document.getElementById('bw-upload-data');
  if (!form || !dataEl) return;
  const info = JSON.parse(dataEl.textContent);
  const fileInput = document.getElementById('bw-mu-file');
  const submitBtn = document.getElementById('bw-mu-submit');
  const status = document.getElementById('bw-mu-status');

  function say(msg, isError) {
    status.hidden = false;
    status.textContent = msg;
    status.style.color = isError ? '#8a2a2a' : '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files && fileInput.files[0];
    if (!file) return say('Pick a file first.', true);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['stl', 'step', 'stp', 'fcstd', 'scad'].includes(ext)) {
      return say('Supported file types: .stl, .step, .stp, .FCStd, .scad.', true);
    }
    submitBtn.disabled = true;
    say('Uploading ' + file.name + '…');
    try {
      const up = await fetch('/api/models/upload?ext=' + ext, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      });
      const upBody = await up.json();
      if (!up.ok) {
        submitBtn.disabled = false;
        return say(upBody.error || 'Upload failed.', true);
      }
      say('Checking and submitting…');
      const sub = await fetch('/api/models/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sha256: upBody.sha256,
          nodeId: info.nodeId,
          license: new FormData(form).get('license'),
          attribution: document.getElementById('bw-mu-attribution').value,
          note: document.getElementById('bw-mu-note').value,
          attest: document.getElementById('bw-mu-attest').checked,
        }),
      });
      const subBody = await sub.json();
      if (!sub.ok) {
        submitBtn.disabled = false;
        return say((subBody.errors || [subBody.error || 'Submission failed.']).join(' · '), true);
      }
      if (subBody.live) {
        say('Done — your model is live. Taking you to the page…');
        window.location.href = '/item/' + info.nodeId + '/';
      } else {
        say(
          'Submitted for review (#' +
            subBody.id +
            '). A reviewer will check it; you can track or withdraw it from this page.',
        );
        setTimeout(() => window.location.reload(), 2500);
      }
    } catch {
      submitBtn.disabled = false;
      say('Network error during upload. Please try again.', true);
    }
  });
})();
