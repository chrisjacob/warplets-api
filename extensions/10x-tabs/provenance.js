Promise.all([
  fetch(chrome.runtime.getURL("manifest.json")).then((response) => response.json()),
  fetch(chrome.runtime.getURL("provenance.json")).then((response) => response.json()),
]).then(([manifest, provenance]) => {
  document.querySelector("#version").textContent = manifest.version;
  document.querySelector("#commit").textContent = provenance.sourceCommit;
  document.querySelector("#manifest").textContent = JSON.stringify({
    permissions: manifest.permissions || [],
    host_permissions: manifest.host_permissions || [],
    chrome_url_overrides: manifest.chrome_url_overrides,
    background: manifest.background,
  }, null, 2);
});
