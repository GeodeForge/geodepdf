(function () {
  var s = document.getElementById('tsplash');
  if (!s) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { s.remove(); return; }
  s.classList.add('on');
  var img = s.querySelector('img'), dead = false;
  function kill(fast) {
    if (dead || !s) return; dead = true;
    if (fast) { s.remove(); s = null; return; }
    s.classList.add('out');
    setTimeout(function () { if (s) { s.remove(); s = null; } }, 1100);
  }
  if (img) { img.addEventListener('error', function () { kill(true); }); }
  setTimeout(function () {
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) {
      window.addEventListener(t, function () { kill(true); }, { once: true, passive: true });
    });
  }, 400);
  requestAnimationFrame(function () { requestAnimationFrame(function () { s.classList.add('in'); }); });
  setTimeout(function () { kill(false); }, 3000);
})();
document.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('[data-copy]') : null;
  if (!b) return;
  if (navigator.clipboard) navigator.clipboard.writeText(b.getAttribute('data-copy'));
  b.textContent = 'Copied';
});
