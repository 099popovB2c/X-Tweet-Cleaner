(() => {
  if (window.__xTweetCleanerLoaded) return;
  window.__xTweetCleanerLoaded = true;

  const DAILY_CEILING = 200;
  const SUCCESS_DELAY_MS = 1100;

  const state = {
    scanned: 0,
    deletableSeen: 0,
    running: false
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const normalize = value =>
    (value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async function getDailyDeleteCount() {
    const key = todayKey();
    const stored = await chrome.storage.local.get([
      "dailyDeleteDate",
      "dailyDeleteCount"
    ]);

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
    return [...document.querySelectorAll('article[data-testid="tweet"]')];
  }

  function getPostText(article) {
    const textNode = article.querySelector('[data-testid="tweetText"]');
    return (textNode?.innerText || textNode?.textContent || "").trim();
  }

  function getStatusUrl(article) {
    const link = [...article.querySelectorAll('a[href*="/status/"]')]
      .find(a => /\/status\/\d+/.test(a.getAttribute("href") || ""));
    return link?.href || null;
  }

  function getCaret(article) {
    return article.querySelector('[data-testid="caret"]');
  }

  function findDeleteMenuItem() {
    const words = [
      "delete",
      "delete post",
      "sil",
      "gönderiyi sil",
      "supprimer",
      "supprimer le post",
      "eliminar",
      "eliminar post",
      "löschen",
      "beitrag löschen",
      "elimina",
      "elimina post",
      "excluir",
      "excluir post",
      "verwijderen"
    ];

    const candidates = [
      ...document.querySelectorAll(
        '[role="menuitem"], [data-testid="Dropdown"] [role="button"], [data-testid="Dropdown"] div[role="menuitem"]'
      )
    ];

    return candidates.find(el => {
      const text = normalize(
        el.innerText ||
        el.textContent ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title")
      );
      return words.some(word => text === word || text.includes(word));
    }) || null;
  }

  function findConfirmDeleteButton() {
    const exact = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    if (exact) return exact;

    const dialog =
      document.querySelector('[role="alertdialog"]') ||
      document.querySelector('[data-testid="sheetDialog"]') ||
      document.querySelector('[data-testid="modal"]') ||
      document.querySelector('[role="dialog"]');

    if (!dialog) return null;

    const words = [
      "delete",
      "sil",
      "supprimer",
      "eliminar",
      "löschen",
      "elimina",
      "excluir",
      "verwijderen"
    ];

    const buttons = [...dialog.querySelectorAll('button, [role="button"]')];

    return buttons.find(button => {
      const text = normalize(
        button.innerText ||
        button.textContent ||
        button.getAttribute("aria-label") ||
        button.getAttribute("title")
      );
      return words.some(word => text === word || text.includes(word));
    }) || null;
  }

  async function waitForDeleteMenuItem(timeoutMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const item = findDeleteMenuItem();
      if (item) return item;
      await sleep(80);
    }
    return null;
  }

  async function waitForConfirmDelete(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const button = findConfirmDeleteButton();
      if (button && !button.disabled) return button;
      await sleep(80);
    }
    return null;
  }

  async function waitForDeleteDialogClose(timeoutMs = 3000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const stillOpen =
        document.querySelector('[data-testid="confirmationSheetConfirm"]') ||
        document.querySelector('[role="alertdialog"]') ||
        document.querySelector('[data-testid="sheetDialog"]');

      if (!stillOpen) return true;
      await sleep(80);
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
      return { ok: false, reason: "post-no-longer-loaded" };
    }

    const daily = await getDailyDeleteCount();
    if (daily >= DAILY_CEILING) {
      return { ok: false, reason: "daily-ceiling-reached" };
    }

    const caret = getCaret(article);
    if (!caret) {
      return { ok: false, reason: "post-menu-not-found" };
    }

    const statusUrl = getStatusUrl(article);
    const text = getPostText(article).slice(0, 160);

    caret.click();

    const deleteItem = await waitForDeleteMenuItem();
    if (!deleteItem) {
      closeOpenMenu();
      await sleep(120);
      return {
        ok: false,
        skipped: true,
        reason: "delete-option-not-available",
        statusUrl,
        text
      };
    }

    deleteItem.click();

    const confirm = await waitForConfirmDelete();
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

    if (!(await waitForDeleteDialogClose())) {
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
    if (state.running) {
      return { ok: false, reason: "already-running" };
    }

    const daily = await getDailyDeleteCount();
    const availableToday = Math.max(0, DAILY_CEILING - daily);

    if (availableToday <= 0) {
      return {
        ok: false,
        reason: "daily-ceiling-reached",
        removed: 0,
        dailyCount: daily
      };
    }

    const requested = Math.max(
      1,
      Math.min(200, Number(requestedLimit) || 1)
    );
    const target = Math.min(requested, availableToday);

    state.running = true;

    try {
      const articles = getPosts();
      const results = [];
      let removed = 0;
      let skipped = 0;
      let stoppedReason = null;

      for (const article of articles) {
        if (removed >= target) break;

        if ((await getDailyDeleteCount()) >= DAILY_CEILING) {
          stoppedReason = "daily-ceiling-reached";
          break;
        }

        const result = await deletePost(article);
        results.push(result);

        if (result.ok) {
          removed += 1;
          await sleep(SUCCESS_DELAY_MS);
          continue;
        }

        if (result.skipped || result.reason === "delete-option-not-available") {
          skipped += 1;
          await sleep(180);
          continue;
        }

        stoppedReason = result.reason || "delete-failed";
        break;
      }

      return {
        ok: true,
        requested: target,
        loaded: articles.length,
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
            ok: false,
            reason: result.stoppedReason || "no-deletable-loaded-post",
            ...result
          });
          return;
        }
        sendResponse(result);
      });
      return true;
    }
  });
})();

