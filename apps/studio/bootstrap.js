// Keep the rack unscaled now that its tablet/mobile layouts are responsive.
// Clearing legacy inline values also protects existing installed PWA sessions
// that may have run an older fixed-width version of this bootstrap script.
(function () {
  function fitChassis() {
    const chassis = document.querySelector(".chassis");
    if (!chassis) return;
    chassis.style.transformOrigin = "top center";
    chassis.style.transform = "none";
    chassis.style.marginBottom = "0";
    document.body.style.height = "";
  }

  window.addEventListener("resize", fitChassis);
  new MutationObserver(fitChassis).observe(document.body, {
    childList: true,
    subtree: true,
  });
  window.setInterval(fitChassis, 500);
})();
