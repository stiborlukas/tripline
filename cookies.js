(function () {
    "use strict";

    const STORAGE_KEY = "tripline_cookies_notice";

    const CSS = `
    #tripline-cookie-notice {
      position: fixed;
      left: 20px;
      right: 20px;
      bottom: 20px;
      z-index: 99990;

      max-width: 940px;
      margin: 0 auto;

      background: #1B2427;
      border: 1px solid #2E3A3D;
      border-left: 3px solid #E2793D;
      border-radius: 2px;

      box-shadow: 0 12px 40px rgba(0,0,0,.35);

      font-family: 'IBM Plex Sans', sans-serif;

      transform: translateY(calc(100% + 30px));
      opacity: 0;

      transition:
        transform .3s cubic-bezier(.4,0,.2,1),
        opacity .3s ease,
        bottom .25s ease;
    }

    #tripline-cookie-notice.tl-cookie-visible {
      transform: translateY(0);
      opacity: 1;
    }

    .tl-cookie-inner {
      padding: 14px 16px;

      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .tl-cookie-label {
      flex-shrink: 0;

      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: .16em;
      text-transform: uppercase;

      color: #E2793D;

      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tl-cookie-label::before {
      content: '';
      width: 14px;
      height: 1px;
      background: #E2793D;
      display: inline-block;
    }

    .tl-cookie-divider {
      width: 1px;
      height: 28px;
      background: #2E3A3D;
      flex-shrink: 0;
    }

    .tl-cookie-text {
      flex: 1;
      min-width: 220px;

      margin: 0;

      font-size: 12px;
      line-height: 1.55;

      color: #9AA096;
    }

    .tl-cookie-btn {
      flex-shrink: 0;

      background: #E2793D;
      color: #12181A;

      border: 1px solid #E2793D;
      border-radius: 2px;

      padding: 9px 16px;

      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .03em;

      cursor: pointer;
      white-space: nowrap;

      transition:
        background .15s,
        border-color .15s,
        transform .12s;
    }

    .tl-cookie-btn:hover {
      background: #EF8B52;
      border-color: #EF8B52;
      transform: translateY(-1px);
    }

    .tl-cookie-btn:active {
      transform: translateY(0);
    }

    @media (max-width: 640px) {
      #tripline-cookie-notice {
        left: 10px;
        right: 10px;
        bottom: 10px;
      }

      .tl-cookie-inner {
        align-items: flex-start;
        gap: 10px;
      }

      .tl-cookie-divider {
        display: none;
      }

      .tl-cookie-text {
        flex-basis: 100%;
        order: 3;
      }

      .tl-cookie-btn {
        margin-left: auto;
      }
    }
  `;

    function positionCookieNotice() {
        const bar = document.getElementById("tripline-cookie-notice");
        const footer = document.querySelector(".site-footer");

        if (!bar || !footer) return;

        const footerRect = footer.getBoundingClientRect();

        if (footerRect.top < window.innerHeight) {
            const distanceFromBottom = window.innerHeight - footerRect.top;

            bar.style.bottom = distanceFromBottom + 12 + "px";
        } else {
            bar.style.bottom = "20px";
        }
    }

    function init() {
        if (localStorage.getItem(STORAGE_KEY)) {
            return;
        }

        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const bar = document.createElement("div");

        bar.id = "tripline-cookie-notice";

        bar.innerHTML = `
          <div class="tl-cookie-inner">

            <div class="tl-cookie-label">
              Tripline · Cookies
            </div>

            <div class="tl-cookie-divider"></div>

            <p class="tl-cookie-text">
              This website uses only strictly necessary technical cookies required for its basic functionality.
            </p>

            <button class="tl-cookie-btn" type="button">
              Got it
            </button>

          </div>
        `;

        document.body.appendChild(bar);

        positionCookieNotice();

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                bar.classList.add("tl-cookie-visible");
            });
        });

        window.addEventListener("scroll", positionCookieNotice, {
            passive: true,
        });

        window.addEventListener("resize", positionCookieNotice);

        bar.querySelector(".tl-cookie-btn").addEventListener("click", () => {
            bar.classList.remove("tl-cookie-visible");

            localStorage.setItem(STORAGE_KEY, "1");

            window.removeEventListener("scroll", positionCookieNotice);
            window.removeEventListener("resize", positionCookieNotice);

            setTimeout(() => {
                bar.remove();
            }, 300);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
