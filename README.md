# X Tweet Cleaner

Open-source Chrome extension for reviewing and deleting your own posts on X/Twitter.

## Features

- Scan posts currently loaded on an X profile page.
- Batch delete 1–100 deletable loaded posts.
- Delete All Loaded mode with typed confirmation.
- Timed Delete mode: for example, 1 deletion every 5 minutes.
- Local daily deletion counter with a conservative 200/day ceiling.
- Verifies X's real Delete option before deleting.
- Verifies X's confirmation dialog before counting a deletion as successful.
- Skips posts where X does not expose a Delete option, such as content you do not own.
- No backend, no password collection, no cookie/token collection.

## Important

**Deleted posts are not recoverable.**

X officially states that you can delete your own posts, but not posts from other accounts. X also states that it does not provide a native way to bulk-delete posts.

This extension automates actions on the X.com website rather than using the paid X API. X's current automation rules warn against non-API website scripting, so use this project at your own risk. The 200/day number used by the extension is a local precaution and is not an official or guaranteed-safe X limit.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extension folder.
6. Open your X profile and load the posts you want to review.
7. Open the extension popup.

## Modes

### Batch Delete

Choose a number from 1 to 100 and confirm the irreversible deletion warning. The extension processes only currently loaded posts and checks each post for X's real Delete menu item.

### Delete All Loaded

Choose a maximum count and type:

`DELETE ALL`

The extension then attempts to delete every currently loaded post for which X exposes the Delete option, stopping at the selected maximum or the local daily ceiling.

### Timed Delete

Example:

- Every: `5 minutes`
- Total posts: `20`

The extension attempts one deletion every five minutes. The target X profile tab must remain open, and posts must remain loaded.

Type:

`DELETE TIMED`

to start.

## Safety behavior

The extension stops or skips when:

- X does not expose a Delete option for a loaded post;
- the confirmation dialog cannot be found or verified;
- the target tab becomes unavailable;
- Timed Delete finds no deletable loaded post;
- the local 200/day ceiling is reached;
- the user presses Stop.

## Privacy

All processing occurs locally in the browser.

The extension does not send usernames, post contents, passwords, cookies, authentication tokens, browsing history, or deletion history to the developer or to an external server.

The only persistent information stored is local extension state such as:

- daily deletion count;
- Timed Delete state;
- Timed Delete remaining count and interval.

## Files

- `manifest.json`
- `content.js`
- `service-worker.js`
- `popup.html`
- `popup.js`
- `popup.css`
- `styles.css`
- `README.md`
- `LICENSE`

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by X Corp.

X may change its website markup at any time, which can break DOM-based automation.

Use this extension only on your own account and only for posts you are authorized to delete.

