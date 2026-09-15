(() => {
  if (window.__xTweetCleaner101Loaded) return;
  window.__xTweetCleaner101Loaded = true;

  const DAILY_CEILING = 200;
  const SUCCESS_DELAY_MIN = 950;
  const SUCCESS_DELAY_JITTER = 450;

  const state = {
    scanned: 0,
    deletableSeen: 0,
    running: false
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value =>
    String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();

  function visible(el) {
    return !!(el && el.isConnected && el.getClientRects().length);
  }

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async function getDailyDeleteCount() {
    const key = todayKey();
    const stored = await chrome.storage.local.get(["dailyDeleteDate", "dailyDeleteCount"]);
    if (stored.dailyDeleteDate !== key) {
      await chrome.storage.local.set({
        dailyDeleteDate: key,
        dailyDeleteCount: 0
      });
      return 0;
    }
    return Number(stored.dailyDeleteCount || 0);
  }

  async function recordSuccessfulDelete() {
    const count = await getDailyDeleteCount();
    await chrome.storage.local.set({
      dailyDeleteDate: todayKey(),
      dailyDeleteCount: count + 1
    });
  }

  function getPosts() {
    return [...document.querySelectorAll('article[data-testid="tweet"]')].filter(visible);
  }

  function getPostText(article) {
    const node = article.querySelector('[data-testid="tweetText"]');
    return String(node?.innerText || node?.textContent || "").trim();
  }

  function getStatusUrl(article) {
    const link = [...article.querySelectorAll('a[href*="/status/"]')]
      .find(a => /\/status\/\d+/.test(a.getAttribute("href") || ""));
    return link?.href || null;
  }

  function postKey(article) {
    const url = getStatusUrl(article);
    const id = url?.match(/\/status\/(\d+)/)?.[1];
    if (id) return `status:${id}`;

    const text = getPostText(article).slice(0, 300);
    const time = article.querySelector("time")?.getAttribute("datetime") || "";
    return `fallback:${time}:${text}`;
  }

  function getCaret(article) {
    return [
      ...article.querySelectorAll(
        '[data-testid="caret"], [data-testid="menuButton"], button[aria-label="More"]'
      )
    ].find(visible) || null;
  }

  function isRepost(article) {
    return Boolean(article.querySelector('[data-testid="unretweet"]'));
  }

  function findDeleteMenuItem() {
    const words = [
      "delete", "delete post", "sil", "gönderiyi sil", "supprimer",
      "supprimer le post", "eliminar", "eliminar post", "löschen",
      "beitrag löschen", "elimina", "elimina post", "excluir",
      "excluir post", "verwijderen"
    ];

    const candidates = [
      ...document.querySelectorAll(
        '[data-testid="Dropdown"] [role="menuitem"], [role="menuitem"]'
      )
    ].filter(visible);

    return candidates.find(el => {
      const text = normalize(
        el.innerText ||
        el.textContent ||
        el.getAttribute("aria-label") ||
        el.getAttrribute("title")
      );
      return words.some(word => text === word || text.includes(word));
    }) || null;
  }

  function findConfirmDeleteButton() {
    const exact = [
      ...document.querySelectorAll('[data-testid="confirmationSheetConfirm"]')
    ].find(visible);
    if (exact) return exact;

    const dialogs = [
      ...document.querySelectorAll(
        '[role="alertdialog"], [data-testid="sheetDialog"], [data-testid="modal"], [role="dialog"]'
      )
    ].filter(visible);

    const words = [
      "delete", "sil", "supprimer", "eliminar", "löschen",
      "elimina", "excluir", "verwijderen"
    ];

    for (const dialog of dialogs) {
      const buttons = [...dialog.querySelectorAll('button, [role="button"]')].filter(visible);
      const match = buttons.find(button => {
        const text = normalize(
          button.innerText ||
          button.textContent ||
          button.getAttribute("aria-label") ||
          button.getAttribute("title")
        );
        return words.some(word => text === word || text.includes(word));
      });
      if (match) return match;
    }

    return null;
  }

  async function waitFor(getter, timeoutMs = 4500, intervalMs = 80) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = getter();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  async function waitForDialogClose(timeoutMs = 4500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const open = [
        ...document.querySelectorAll(
          '[data-testid="confirmationSheetConfirm"], [role="alertdialog"], [data-testid="sheetDialog"]'
        )
      ].some(visible);
      if (!open) return true;
      await sleep(90);
    }
    return false;
  }

  function closeOpenMenu() {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true
    }));
  }

  async function deletePost(article) {
    if (!article?.isConnected) {
      return { ok: false, skipped: true, reason: "post-no-longer-loaded" };
    }

    if ((await getDailyDeleteCount()) >= DAILY_CEILING) {
      return { ok: false, reason: "daily-ceiling-reached" };
    }

    const statusUrl = getStatusUrl(article);
    const text = getPostText(article).slice(0, 160);

    if (isRepost(article)) {
      return {
        ok: false,
        skipped: true,
        reason: "repost-not-a-deletable-post",
        statusUrl,
        text
      };
    }

    article.scrollIntoView({ behavior: "auto", block: "center" });
    await sleep(180);

    const caret = getCaret(article);
    if (!caret) {
      return {
        ok: false,
        skipped: true,
        reason: "post-menu-not-found",
        statusUrl,
        text
      };
    }

    closeOpenMenu();
    caret.click();

    const deleteItem = await waitFor(findDeleteMenuItem, 4000);
    if (!deleteItem) {
      closeOpenMenu();
      return {
        ok: false,
        skipped: true,
        reason: "delete-option-not-available",
        statusUrl,
        text
      };
    }

    deleteItem.click();

    const confirm = await waitFor(findConfirmDeleteButton, 5500);
    if (!confirm) {
      closeOpenMenu();
      return {
        ok: false,
        reason: "delete-confirmation-not-found",
        statusUrl,
        text
      };
    }

    confirm.click();

    if (!(await waitForDialogClose())) {
      return {
        ok: false,
        reason: "delete-confirmation-did-not-close",
        statusUrl,
        text
      };
    }

    await recordSuccessfulDelete();

    return {
      ok: true,
      statusUrl,
      text
    };
  }

  async function runDeleteSequence(requestedLimit) {
    if (state.running) return { ok: false, reason: "already-running" };

    const daily = await getDailyDeleteCount();
    const availableToday = Math.max(0, DAILY_CEILING - daily);
    if (!availableToday) {
      return {
        ok: false,
        reason: "daily-ceiling-reached",
        removed: 0,
        dailyCount: daily
      };
    }

    const requested = Math.max(1, Math.min(200, Number(requestedLimit) || 1));
    const target = Math.min(requested, availableToday);

    state.running = true;

    try {
      const processed = new Set();
      const results = [];
      let removed = 0;
      let skipped = 0;
      let stoppedReason = null;

      while (removed < target) {
        if ((await getDailyDeleteCount()) >= DAILY_CEILING) {
          stoppedReason = "daily-ceiling-reached";
          break;
        }

        const article = getPosts().find(post => !processed.has(postKey(post)));
        if (!article) {
          stoppedReason = "no-more-loaded-unprocessed-posts";
          break;
        }

        const key = postKey(article);
        processed.add(key);

        const result = await deletePost(article);
        results.push(result);

        if (result.ok) {
          removed += 1;
          await sleep(SUCCESS_DELAY_MIN + Math.floor(Math.random() * SUCCESS_DELAY_JITTER));
          continue;
        }

        if (result.skipped) {
          skipped += 1;
          await sleep(160);
          continue;
        }

        stoppedReason = result.reason || "delete-failed";
        break;
      }

      return {
        ok: true,
        requested: target,
        processed: processed.size,
        removed,
        skipped,
        stoppedReason,
        dailyCount: await getDailyDeleteCount(),
        results
      };
    } finally {
      state.running = false;
    }
  }

  async function scan() {
    const posts = getPosts();
    state.scanned = posts.length;
    state.deletableSeen = posts.filter(post => !isRepost(post) && getCaret(post)).length;

    return {
      ...state,
      dailyCount: await getDailyDeleteCount()
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) return;

    if (message.type === "XTC_SCAN") {
      scan().then(sendResponse);
      return true;
    }

    if (message.type === "XTC_DELETE_BATCH") {
      runDeleteSequence(message.limit).then(sendResponse);
      return true;
    }

    if (message.type === "XTC_DELETE_TIMED_TICK") {
      runDeleteSequence(1).then(result => {
        if (result?.ok && result.removed < 1) {
          sendResponse({
            ...result,
            ok: false,
            reason: result.stoppedReason || "no-deletable-loaded-post"
          });
          return;
        }
        sendResponse(result);
      });
      return true;
    }
  });
})();