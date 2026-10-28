# Chat Builder

Script a fake chat (a DM or a group), hit **Generate**, and it plays back as an animated phone mockup that you can screen-record.

It's a static site with no build step and no dependencies, so it runs as-is on GitHub Pages.

## Features

- DM or group chat, with colored sender names and avatars in groups
- Typing indicators ("typing…" in the header plus a bubble with animated dots)
- Your own messages get typed into the input bar, then sent with a pop-in animation
- Ticks go sent → delivered → read (blue)
- Dark and light themes, a plain or doodle wallpaper, adjustable speed and start time
- Synthesized send and receive sounds, so there are no audio files to host
- **Present** mode hides the editor and scales the phone to fill the window. Space plays, Esc exits
- **Record** (Chrome or Edge on desktop) captures the tab, crops it to the stage and downloads an MP4 or WebM. When the share dialog asks for audio, tick "Share tab audio" to include the sounds
- **Copy link** puts the whole chat into the URL (compressed), so you can share or bookmark a script
- Autosaves to localStorage

## Script format

```
Maya: who's bringing the tent?
Sam: not me 😅
Me: I can bring mine
[pause 1.5]
Leo: legend
```

Use your name (or `Me` / `You`) for your own messages. Any new name in a group becomes a member. A line without `Name:` continues the previous message.

You can also paste messages copied from WhatsApp (`[11:31 PM, 27/10/2026] Name: text`) or a chat export (`27/10/2026, 11:31 pm - Name: text`). The timestamps are dropped and the first one becomes the start time. If more than one other person is talking, the chat switches to a group.

## Run locally

```bash
python3 -m http.server 5178
```

Then open http://localhost:5178.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. In the repo, open **Settings → Pages**, choose **Deploy from a branch**, then pick `main` and `/ (root)`.

## Files

- `index.html`: editor and phone markup
- `css/phone.css`: the phone mockup (themes, bubbles, tails, composer)
- `css/app.css`: editor and stage
- `js/player.js`: renders the chat and runs the timed animation
- `js/app.js`: editor state, script parsing, share links, present mode and recording
- `js/sounds.js`: WebAudio UI sounds
