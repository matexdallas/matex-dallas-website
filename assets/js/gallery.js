/* MATEX Dallas — Gallery lightbox (gallery.html only) */
(function () {
  "use strict";

  var thumbs = document.querySelectorAll(".filter-gallery button.thumb");
  var lightbox = document.getElementById("lightbox");
  if (!thumbs.length || !lightbox) return;

  var lbImg = lightbox.querySelector("img");
  var lbCaption = lightbox.querySelector(".lb-caption");
  var closeBtn = lightbox.querySelector(".lb-close");
  var lastTrigger = null;

  function open(trigger) {
    var img = trigger.querySelector("img");
    lastTrigger = trigger;
    lbImg.src = img.src;
    lbImg.alt = img.alt;
    lbCaption.textContent = img.alt;
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
    closeBtn.focus();
    document.body.style.overflow = "hidden";
  }

  function close() {
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
    lbImg.src = "";
    document.body.style.overflow = "";
    if (lastTrigger) lastTrigger.focus();
  }

  thumbs.forEach(function (btn) {
    btn.addEventListener("click", function () { open(btn); });
  });

  closeBtn.addEventListener("click", close);

  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox) close();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && lightbox.classList.contains("open")) close();
  });
})();
