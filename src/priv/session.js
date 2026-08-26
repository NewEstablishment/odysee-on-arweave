(function () {
  var key = "{{TRACKING_KEY}}";
  var visitorIdMode = "{{VISITOR_ID_MODE}}";
  var script = document.currentScript;
  if ((!key || key.indexOf("{{") === 0) && script) {
    key = script.getAttribute("data-analytics-key") || script.getAttribute("data-key") || "";
  }
  if (!key) return;

  function deviceUrl(action) {
    try {
      return new URL("/~analytics@1.0/" + action, script ? script.src : window.location.href).toString();
    } catch (_err) {
      return "/~analytics@1.0/" + action;
    }
  }

  var endpoint = deviceUrl("session");
  var eventEndpoint = deviceUrl("event");

  // Acquisition + audience dimensions. The browser sends the User-Agent header
  // automatically (parsed server-side for device/browser/OS), so the tracker
  // only adds the referrer source, UTM tags and language. These are stable for
  // the page load, so they are captured once and sent with each ping.
  var referrer = document.referrer || "";
  var language = navigator.language || (navigator.languages && navigator.languages[0]) || "";
  var utm = readUtm();

  function readUtm() {
    var out = {};
    try {
      var search = new URLSearchParams(window.location.search);
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(function (name) {
        var value = search.get(name);
        if (value) out[name] = value;
      });
    } catch (_err) {}
    return out;
  }

  var visit = createVisitId();
  var visitorId = persistentVisitorId();
  var page = currentPath();
  var visibleSince = document.visibilityState === "visible" ? now() : null;
  var activeMs = 0;
  var ended = false;

  function createVisitId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var idx = 0; idx < bytes.length; idx += 1) bytes[idx] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function persistentVisitorId() {
    if (visitorIdMode !== "persistent") return "";
    var storageKey = "hyperbeam-analytics:" + key + ":visitor";
    try {
      var existing = window.localStorage.getItem(storageKey);
      if (existing) return existing;
      var created = createVisitId();
      window.localStorage.setItem(storageKey, created);
      return created;
    } catch (_err) {
      return "";
    }
  }

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function activeDuration() {
    if (visibleSince === null) return Math.round(activeMs);
    return Math.round(activeMs + now() - visibleSince);
  }

  function cleanPath(value) {
    var path = String(value || "/").split("?")[0].split("#")[0] || "/";
    if (path.charAt(0) !== "/") path = "/" + path;
    return path;
  }

  function hashRoutePath() {
    var hash = window.location.hash || "";
    if (hash.indexOf("#/") === 0) return cleanPath(hash.slice(1));
    if (hash.indexOf("#!") === 0) return cleanPath(hash.slice(2));
    return "";
  }

  function currentPath() {
    return hashRoutePath() || cleanPath(window.location.pathname || "/");
  }

  function params(eventName) {
    var query = new URLSearchParams();
    query.set("key", key);
    query.set("visit", visit);
    query.set("event", eventName);
    query.set("duration", String(activeDuration()));
    query.set("page", page);
    if (visitorId) query.set("visitor-id", visitorId);
    if (referrer) query.set("referrer", referrer);
    if (language) query.set("language", language);
    Object.keys(utm).forEach(function (name) {
      query.set(name, utm[name]);
    });
    return query;
  }

  // Custom events for conversion tracking, e.g. window.analytics("Signup").
  function trackEvent(name, value) {
    if (!name) return;
    var query = new URLSearchParams();
    query.set("key", key);
    query.set("name", String(name));
    query.set("page", page);
    if (value !== undefined && value !== null) query.set("duration", String(value));
    var url = eventEndpoint + "?" + query.toString();
    try {
      fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        keepalive: true
      }).catch(function () {});
    } catch (_err) {}
  }

  try {
    window.analytics = trackEvent;
  } catch (_err) {}

  function send(eventName) {
    var url = endpoint + "?" + params(eventName).toString();
    // The `end` ping has to survive page unload, where in-flight requests are
    // easily dropped. Fire it through BOTH unload-safe transports: sendBeacon
    // (a POST, purpose-built for unload and the most reliable) and a keepalive
    // fetch (a GET) as a backup. Either one reaching the device is enough —
    // both just set the visit's `ended` flag, so a duplicate is harmless.
    // keepalive-fetch alone proved flaky on close, hence the sendBeacon primary.
    if (eventName === "end") {
      try {
        if (navigator.sendBeacon) navigator.sendBeacon(url);
      } catch (_beaconErr) {}
    }
    try {
      fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        keepalive: true
      }).catch(function () {});
    } catch (_err) {}
  }

  function settleVisibility() {
    if (document.visibilityState === "visible") {
      if (visibleSince === null) visibleSince = now();
    } else if (visibleSince !== null) {
      activeMs += now() - visibleSince;
      visibleSince = null;
      send("heartbeat");
    }
  }

  function end() {
    if (ended) return;
    ended = true;
    if (visibleSince !== null) {
      activeMs += now() - visibleSince;
      visibleSince = null;
    }
    send("end");
  }

  function restartForPage(nextPage) {
    if (!nextPage || nextPage === page) return;
    end();
    visit = createVisitId();
    page = nextPage;
    activeMs = 0;
    visibleSince = document.visibilityState === "visible" ? now() : null;
    ended = false;
    send("start");
  }

  function checkPageChange() {
    restartForPage(currentPath());
  }

  function patchHistoryMethod(name) {
    var original = window.history && window.history[name];
    if (typeof original !== "function") return;
    window.history[name] = function () {
      var result = original.apply(this, arguments);
      window.setTimeout(checkPageChange, 0);
      return result;
    };
  }

  document.addEventListener("visibilitychange", settleVisibility, { passive: true });
  window.addEventListener("hashchange", checkPageChange, { passive: true });
  window.addEventListener("popstate", checkPageChange, { passive: true });
  window.addEventListener("pagehide", end, { passive: true });
  window.addEventListener("beforeunload", end, { passive: true });
  // Only `pushState` (genuine forward navigation) counts as a new page-view.
  // `replaceState` is used for redirects (auth guards, default-route redirects,
  // React Router's `<Navigate replace>`) and for query-param/state updates — an
  // SPA can fire several on a single load, so counting them mints phantom
  // page-views and inflates the view count. `popstate` still covers back/fwd.
  patchHistoryMethod("pushState");

  send("start");
  window.setInterval(function () {
    // Heartbeat while the tab is OPEN, even when backgrounded, so an open tab
    // keeps counting as a current visitor ("active = open tabs"). Browsers
    // throttle background timers to roughly once a minute, which the active
    // window tolerates. Closing the tab sends `end`, which drops it at once.
    if (!ended) send("heartbeat");
  }, 15000);
})();
