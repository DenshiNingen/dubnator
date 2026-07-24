// Viewport fitting for the fixed-width rack. Kept outside the HTML so the
// desktop shell can enforce a script-src 'self' content-security policy.
(function () {
  function fitChassis() {
    const chassis = document.querySelector(".chassis");
    if (!chassis) return;
    const scale = Math.min(window.innerWidth / chassis.offsetWidth, 1);
    chassis.style.transformOrigin = "top center";
    chassis.style.transform = `scale(${scale})`;
    chassis.style.marginBottom = `${chassis.offsetHeight * (scale - 1)}px`;
    document.body.style.height = "";
  }

  window.addEventListener("resize", fitChassis);
  new MutationObserver(fitChassis).observe(document.body, {
    childList: true,
    subtree: true,
  });
  window.setInterval(fitChassis, 500);
})();
