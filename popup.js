const $ = id => document.getElementById(id);
const TIMED_ALARM = "XTC_TIMED_DELETE";

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}

async function sendToTab(type, payload = {}) {
  const tab = await activeTab();

  if (!tab?.id || !/^https:\/\/(x|twitter)\.com\//.test(tab.url || "")) {
    throw new Error("Open X.com in the active tab first.");
  }

  return chrome.tabs.sendMessage(tab.id, { type, ...payload });
}

async function getDailyCount() {
  const stored = await chrome.storage.local.get([
    "dailyDeleteDate",
    "dailyDeleteCount"
  ]);

  if (stored.dailyDeleteDate !== todayKey()) {
    await chrome.storage.local.set({
      dailyDeleteDate: todayKey(),
      dailyDeleteCount: 0
    });
    return 0;
  }

  return Number(stored.dailyDeleteCount || 0);
}

async function renderDailyCounter() {
  const count = await getDailyCount();
  $("dailyCount").textContent = `${count} / 200`;
  $("dailyRemaining").textContent = `${Math.max(0, 200 - count)} left`;
  $("dailyMeter").style.width = `${Math.min(100, (count / 200) * 100)}%`;
  return count;
}

function formatRemaining(ms) {
  if (ms <= 0) return "due now";
  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

async function renderTimedStatus() {
  const stored = await chrome.storage.local.get([
    "timedDeleteActive",
    "timedDeleteIntervalMinutes",
    "timedDeleteRemaining",
    "timedDeleteCompleted",
    "timedDeleteLastError",
    "timedDeleteStopReason"
  ]);

  const active = Boolean(stored.timedDeleteActive);

  $("timedStart").disabled = active;
  $("timedStop").disabled = !active;
  $("timedMinutes").disabled = active;
  $("timedTotal").disabled = active;

  if (active) {
    const alarm = await chrome.alarms.get(TIMED_ALARM);
    const next = alarm?.scheduledTime
      ? formatRemaining(alarm.scheduledTime - Date.now())
      : "being restored";

    $("timedStatus").textContent =
      `Running: every ${stored.timedDeleteIntervalMinutes} min • ` +
      `${stored.timedDeleteRemaining} remaining • next in ${next}`;
    return;
  }

  if (stored.timedDeleteLastError) {
    $("timedStatus").textContent = `Stopped: ${stored.timedDeleteLastError}`;
    return;
  }

  if (stored.timedDeleteStopReason === "completed") {
    $("timedStatus").textContent =
      `Completed. ${stored.timedDeleteCompleted || 0} post(s) deleted.`;
    return;
  }

  $("timedStatus").textContent = "Stopped.";
}

$("scan").addEventListener("click", async () => {
  try {
    const result = await sendToTab("XTC_SCAN");
    $("scanned").textContent = result?.scanned ?? 0;
    await renderDailyCounter();
    $("status").textContent =
      `Found ${result?.scanned ?? 0} loaded post(s). Delete eligibility is verified only when each post menu is opened.`;
  } catch (error) {
    $("status").textContent = error.message || String(error);
  }
});

$("batchDelete").addEventListener("click", async () => {
  const count = Math.max(
    1,
    Math.min(100, Number($("batchCount").value) || 10)
  );
  $("batchCount").value = String(count);

  const today = await renderDailyCounter();

  const ok = window.confirm(
    `Delete up to ${count} of your loaded deletable post(s)?\n\n` +
    `Deleted posts are NOT recoverable.\n` +
    `Today: ${today}/200.\n\n` +
    `The extension will verify X's Delete option and confirmation for each post.`
  );

  if (!ok) return;

  $("status").textContent = `Deleting up to ${count} post(s)…`;

  try {
    const result = await sendToTab("XTC_DELETE_BATCH", { limit: count });

    if (!result?.ok) {
      $("status").textContent = `Stopped: ${result?.reason || "unknown error"}.`;
      return;
    }

    await renderDailyCounter();

    $("status").textContent =
      `Completed: ${result.removed} deleted, ${result.skipped} skipped` +
      (result.stoppedReason ? ` • stopped: ${result.stoppedReason}` : "") +
      `.`;
  } catch (error) {
    $("status").textContent = error.message || String(error);
  }
});

$("deleteAll").addEventListener("click", async () => {
  const today = await renderDailyCounter();

  if (today >= 200) {
    $("status").textContent = "Daily 200 safety ceiling reached.";
    return;
  }

  const requested = Math.max(
    1,
    Math.min(200, Number($("allCount").value) || 50)
  );
  $("allCount").value = String(requested);

  const effective = Math.min(requested, 200 - today);

  const typed = window.prompt(
    `PERMANENT DELETION WARNING\n\n` +
    `Up to ${effective} loaded deletable post(s) can be deleted.\n` +
    `Deleted posts cannot be recovered.\n\n` +
    `Type DELETE ALL to continue.`
  );

  if (typed !== "DELETE ALL") {
    $("status").textContent = "Delete All cancelled.";
    return;
  }

  $("status").textContent = `Delete All running: up to ${effective} post(s)…`;

  try {
    const result = await sendToTab("XTC_DELETE_BATCH", {
      limit: effective
    });

    if (!result?.ok) {
      $("status").textContent = `Stopped: ${result?.reason || "unknown error"}.`;
      return;
    }

    await renderDailyCounter();

    $("status").textContent =
      `Delete All completed: ${result.removed} deleted, ${result.skipped} skipped` +
      (result.stoppedReason ? ` • stopped: ${result.stoppedReason}` : "") +
      `.`;
  } catch (error) {
    $("status").textContent = error.message || String(error);
  }
});

$("timedStart").addEventListener("click", async () => {
  const minutes = Math.max(
    1,
    Math.min(1440, Number($("timedMinutes").value) || 5)
  );

  const total = Math.max(
    1,
    Math.min(200, Number($("timedTotal").value) || 20)
  );

  $("timedMinutes").value = String(minutes);
  $("timedTotal").value = String(total);

  const tab = await activeTab();

  if (!tab?.id || !/^https:\/\/(x|twitter)\.com\//.test(tab.url || "")) {
    $("timedStatus").textContent = "Open your X profile page first.";
    return;
  }

  const today = await renderDailyCounter();

  if (today >= 200) {
    $("timedStatus").textContent = "Daily 200 safety ceiling reached.";
    return;
  }

  const possibleToday = Math.min(total, 200 - today);

  const typed = window.prompt(
    `PERMANENT DELETION WARNING\n\n` +
    `1 deletion every ${minutes} minute(s)\n` +
    `Requested total: ${total}\n` +
    `Maximum before today's local 200 ceiling: ${possibleToday}\n\n` +
    `Deleted posts cannot be recovered.\n` +
    `Type DELETE TIMED to continue.`
  );

  if (typed !== "DELETE TIMED") {
    $("timedStatus").textContent = "Timed Delete cancelled.";
    return;
  }

  await chrome.alarms.clear(TIMED_ALARM);

  await chrome.storage.local.set({
    timedDeleteActive: true,
    timedDeleteTargetTabId: tab.id,
    timedDeleteIntervalMinutes: minutes,
    timedDeleteRemaining: total,
    timedDeleteCompleted: 0,
    timedDeleteStartedAt: Date.now(),
    timedDeleteStoppedAt: null,
    timedDeleteStopReason: null,
    timedDeleteLastError: null
  });

  await chrome.alarms.create(TIMED_ALARM, {
    delayInMinutes: minutes,
    periodInMinutes: minutes
  });

  await renderTimedStatus();
});

$("timedStop").addEventListener("click", async () => {
  await chrome.alarms.clear(TIMED_ALARM);
  await chrome.storage.local.set({
    timedDeleteActive: false,
    timedDeleteStoppedAt: Date.now(),
    timedDeleteStopReason: "user-stopped"
  });
  await renderTimedStatus();
});

(async () => {
  await renderDailyCounter();
  await renderTimedStatus();

  setInterval(() => {
    renderDailyCounter().catch(() => {});
    renderTimedStatus().catch(() => {});
  }, 1000);
})();

