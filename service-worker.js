const TIMED_ALARM = "XTC_TIMED_DELETE";
const DAILY_CEILING = 200;

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

async function stopTimed(reason, extra = {}) {
  await chrome.alarms.clear(TIMED_ALARM);
  await chrome.storage.local.set({
    timedDeleteActive: false,
    timedDeleteStoppedAt: Date.now(),
    timedDeleteStopReason: reason,
    ...extra
  });
}

async function restoreTimedAlarm() {
  const stored = await chrome.storage.local.get([
    "timedDeleteActive",
    "timedDeleteIntervalMinutes",
    "timedDeleteRemaining"
  ]);

  if (!stored.timedDeleteActive) return;

  if (Number(stored.timedDeleteRemaining || 0) <= 0) {
    await stopTimed("completed");
    return;
  }

  const existing = await chrome.alarms.get(TIMED_ALARM);
  if (existing) return;

  const minutes = Math.max(
    1,
    Math.min(1440, Number(stored.timedDeleteIntervalMinutes) || 5)
  );

  await chrome.alarms.create(TIMED_ALARM, {
    delayInMinutes: minutes,
    periodInMinutes: minutes
  });
}

chrome.runtime.onInstalled.addListener(() => {
  restoreTimedAlarm().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  restoreTimedAlarm().catch(() => {});
});

restoreTimedAlarm().catch(() => {});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== TIMED_ALARM) return;

  const stored = await chrome.storage.local.get([
    "timedDeleteActive",
    "timedDeleteTargetTabId",
    "timedDeleteRemaining",
    "timedDeleteCompleted"
  ]);

  if (!stored.timedDeleteActive) {
    await chrome.alarms.clear(TIMED_ALARM);
    return;
  }

  if ((await getDailyCount()) >= DAILY_CEILING) {
    await stopTimed("daily-ceiling-reached", {
      timedDeleteLastError: "Daily 200 safety ceiling reached."
    });
    return;
  }

  const remaining = Number(stored.timedDeleteRemaining || 0);
  if (remaining <= 0) {
    await stopTimed("completed");
    return;
  }

  const tabId = Number(stored.timedDeleteTargetTabId);
  if (!Number.isInteger(tabId)) {
    await stopTimed("target-tab-missing", {
      timedDeleteLastError: "Target X profile tab is missing."
    });
    return;
  }

  let result;

  try {
    result = await chrome.tabs.sendMessage(tabId, {
      type: "XTC_DELETE_TIMED_TICK"
    });
  } catch (error) {
    await stopTimed("target-tab-unavailable", {
      timedDeleteLastError:
        "The target X profile tab is closed or unavailable."
    });
    return;
  }

  if (!result?.ok) {
    await stopTimed(result?.reason || "delete-failed", {
      timedDeleteLastError:
        result?.reason === "no-deletable-loaded-post"
          ? "No deletable loaded post was found. Scroll your profile to load more of your posts, then start Timed Delete again."
          : `Timed delete stopped: ${result?.reason || "unknown error"}.`
    });
    return;
  }

  const removed = Number(result.removed || 0);
  if (removed < 1) {
    await stopTimed("no-deletable-loaded-post", {
      timedDeleteLastError: "No deletable loaded post was found."
    });
    return;
  }

  const nextRemaining = Math.max(0, remaining - 1);
  const completed = Number(stored.timedDeleteCompleted || 0) + 1;

  await chrome.storage.local.set({
    timedDeleteRemaining: nextRemaining,
    timedDeleteCompleted: completed,
    timedDeleteLastRunAt: Date.now(),
    timedDeleteLastError: null
  });

  if (nextRemaining <= 0) {
    await stopTimed("completed");
  }
});

