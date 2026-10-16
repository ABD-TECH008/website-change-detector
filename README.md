# Watch Party

A real-time multi-user watch-party web app built with Node.js, Express and Socket.IO.

## Features
- Create a room or join with a room code; invite friends by sharing the code.
- Host-controlled playback synchronization for direct MP4/WebM URLs.
- Late-join state sync and periodic host heartbeat.
- Drift correction for participants, with visible drift status.
- Live chat, floating emoji reactions, shared playlist, group polls, and host transfer.
- Responsive interface for desktop and mobile.

## Requirements
- Node.js 18 or newer
- Internet access for npm install and for any externally hosted video URL

## Run locally
1. Install Node.js from the official Node.js website if needed.
2. Extract this project ZIP and open the `watch_party_project` folder in VS Code.
3. Open Terminal in VS Code and run:
   ```bash
   npm install
   npm start
   ```
4. Open `http://localhost:3000`.
5. Create a room, then share the room code with other users.

## Test with two users
- Open the app in two browser windows (or one normal and one incognito window).
- Create a room in the first window and join it from the second with the room code.
- In the host window, paste a direct `.mp4` or `.webm` URL and click **Load video**.
- Use the host controls to play, pause, or seek. Try chat, reactions, playlist, voting and host transfer.

## Important notes
- Browsers may require each participant to click Play once before audio/video can play.
- Use a direct video-file URL that allows cross-origin playback. YouTube watch-page links are not direct media URLs and will not work in the native video player.
- This is a working student-project prototype. For public deployment, add authentication, rate limiting, persistent storage, HTTPS, room expiry, and stronger input validation.
- Playback sync is designed for local-network/project-demo use; actual latency depends on the network and video hosting provider.

## Suggested demo checklist
1. Create a room and join from 2+ browsers.
2. Show synchronized play/pause/seek and the drift readout.
3. Add a playlist item and have the host play it.
4. Send a chat message and an emoji reaction.
5. Create a poll and vote from both browsers.
6. Transfer host permissions and show that host controls move.
