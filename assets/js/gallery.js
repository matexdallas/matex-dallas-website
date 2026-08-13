/* MATEX Dallas — Gallery lightbox (gallery.html only) */
(function () {
  "use strict";

  var thumbs = Array.prototype.slice.call(document.querySelectorAll(".filter-gallery button.thumb"));
  var lightbox = document.getElementById("lightbox");
  if (!thumbs.length || !lightbox) return;

  var lbImg = lightbox.querySelector("img");
  var lbCaption = lightbox.querySelector(".lb-caption");
  var lbCounter = lightbox.querySelector(".lb-counter");
  var closeBtn = lightbox.querySelector(".lb-close");
  var prevBtn = lightbox.querySelector(".lb-prev");
  var nextBtn = lightbox.querySelector(".lb-next");
  var focusable = [closeBtn, prevBtn, nextBtn];
  var lastTrigger = null;
  var currentIndex = -1;

  function show(index) {
    currentIndex = (index + thumbs.length) % thumbs.length;
    var img = thumbs[currentIndex].querySelector("img");
    lbImg.src = img.src;
    lbImg.alt = img.alt;
    lbCaption.textContent = img.alt;
    lbCounter.textContent = "Photo " + (currentIndex + 1) + " of " + thumbs.length;
  }

  function open(index) {
    lastTrigger = thumbs[index];
    show(index);
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeydown);
    closeBtn.focus();
  }

  function close() {
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
    lbImg.src = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    if (lastTrigger) lastTrigger.focus();
  }

  function prev() { show(currentIndex - 1); }
  function next() { show(currentIndex + 1); }

  function onKeydown(e) {
    switch (e.key) {
      case "Escape":
        close();
        break;
      case "ArrowLeft":
        prev();
        break;
      case "ArrowRight":
        next();
        break;
      case "Tab":
        trapFocus(e);
        break;
    }
  }

  // Keeps Tab/Shift+Tab cycling within the lightbox's three controls while it's open.
  function trapFocus(e) {
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  thumbs.forEach(function (btn, index) {
    btn.addEventListener("click", function () { open(index); });
  });

  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);

  // Click anywhere outside the image/caption (i.e. directly on the backdrop) closes.
  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox) close();
  });
})();
