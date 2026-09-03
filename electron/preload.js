// Minimal bridge. Renderer runs the same signing code as the web version;
// no privileged APIs are exposed. If native OS dialogs are wanted later,
// add contextBridge.exposeInMainWorld here.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('electron');
});
