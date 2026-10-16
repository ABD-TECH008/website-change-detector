const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

const rooms = new Map();
const now = () => Date.now();
const roomCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();

function safeRoom(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}
function publicRoom(room) {
  return {
    code: room.code, hostId: room.hostId, hostName: room.hostName,
    title: room.title, videoUrl: room.videoUrl, playing: room.playing,
    position: room.position, updatedAt: room.updatedAt,
    playlist: room.playlist, poll: room.poll,
    users: [...room.users.values()].map(u => ({ id: u.id, name: u.name }))
  };
}
function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}
function getRoom(code) { return rooms.get(safeRoom(code)); }

io.on("connection", socket => {
  socket.on("room:create", ({ name } = {}, done = () => {}) => {
    let code = roomCode();
    while (rooms.has(code)) code = roomCode();
    const cleanName = String(name || "Guest").trim().slice(0, 24) || "Guest";
    const room = {
      code, hostId: socket.id, hostName: cleanName, title: "Nothing playing yet",
      videoUrl: "", playing: false, position: 0, updatedAt: now(),
      users: new Map(), playlist: [], poll: null
    };
    room.users.set(socket.id, { id: socket.id, name: cleanName });
    rooms.set(code, room);
    socket.join(code);
    done({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, name } = {}, done = () => {}) => {
    const room = getRoom(code);
    if (!room) return done({ ok: false, error: "Room not found. Check the code and try again." });
    const cleanName = String(name || "Guest").trim().slice(0, 24) || "Guest";
    room.users.set(socket.id, { id: socket.id, name: cleanName });
    socket.join(room.code);
    socket.emit("room:state", publicRoom(room));
    socket.to(room.code).emit("chat:system", `${cleanName} joined the room`);
    emitRoom(room);
    done({ ok: true, room: publicRoom(room) });
  });

  socket.on("playback:command", ({ code, action, position, videoUrl, title } = {}) => {
    const room = getRoom(code);
    if (!room || room.hostId !== socket.id) return;
    if (typeof videoUrl === "string") room.videoUrl = videoUrl.trim().slice(0, 1500);
    if (typeof title === "string") room.title = title.trim().slice(0, 120) || "Untitled video";
    if (Number.isFinite(position)) room.position = Math.max(0, position);
    if (action === "play") room.playing = true;
    if (action === "pause" || action === "load" || action === "seek") room.playing = false;
    room.updatedAt = now();
    io.to(room.code).emit("playback:sync", {
      action, position: room.position, videoUrl: room.videoUrl, title: room.title,
      playing: room.playing, updatedAt: room.updatedAt, by: socket.id
    });
    emitRoom(room);
  });

  socket.on("playback:heartbeat", ({ code, position, playing } = {}) => {
    const room = getRoom(code);
    if (!room || room.hostId !== socket.id || !Number.isFinite(position)) return;
    room.position = Math.max(0, position);
    room.playing = !!playing;
    room.updatedAt = now();
  });

  socket.on("chat:send", ({ code, message } = {}) => {
    const room = getRoom(code);
    if (!room || !room.users.has(socket.id)) return;
    const text = String(message || "").trim().slice(0, 500);
    if (!text) return;
    io.to(room.code).emit("chat:message", {
      id: crypto.randomUUID(), name: room.users.get(socket.id).name,
      text, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    });
  });

  socket.on("reaction:send", ({ code, emoji } = {}) => {
    const room = getRoom(code);
    if (!room || !room.users.has(socket.id)) return;
    const allowed = ["😂", "😍", "👏", "😮", "🔥", "😭", "❤️"];
    if (!allowed.includes(emoji)) return;
    io.to(room.code).emit("reaction:show", { emoji, name: room.users.get(socket.id).name });
  });

  socket.on("playlist:add", ({ code, title, url } = {}) => {
    const room = getRoom(code);
    if (!room || !room.users.has(socket.id)) return;
    title = String(title || "").trim().slice(0, 120);
    url = String(url || "").trim().slice(0, 1500);
    if (!title || !url) return;
    room.playlist.push({ id: crypto.randomUUID(), title, url, addedBy: room.users.get(socket.id).name });
    emitRoom(room);
  });
  socket.on("playlist:play", ({ code, id } = {}) => {
    const room = getRoom(code);
    if (!room || room.hostId !== socket.id) return;
    const item = room.playlist.find(x => x.id === id);
    if (!item) return;
    room.videoUrl = item.url; room.title = item.title; room.position = 0;
    room.playing = false; room.updatedAt = now();
    io.to(room.code).emit("playback:sync", {
      action: "load", position: 0, videoUrl: room.videoUrl, title: room.title,
      playing: false, updatedAt: room.updatedAt, by: socket.id
    });
    emitRoom(room);
  });

  socket.on("poll:create", ({ code, question, options } = {}) => {
    const room = getRoom(code);
    if (!room || room.hostId !== socket.id) return;
    const opts = (Array.isArray(options) ? options : []).map(x => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 4);
    if (!String(question || "").trim() || opts.length < 2) return;
    room.poll = { id: crypto.randomUUID(), question: String(question).trim().slice(0, 160),
      options: opts.map((label, i) => ({ label, votes: 0, voters: [] })) };
    emitRoom(room);
  });
  socket.on("poll:vote", ({ code, index } = {}) => {
    const room = getRoom(code);
    if (!room || !room.poll || !room.users.has(socket.id)) return;
    room.poll.options.forEach(o => { o.voters = o.voters.filter(id => id !== socket.id); });
    const option = room.poll.options[index];
    if (option) { option.voters.push(socket.id); option.votes = option.voters.length; }
    emitRoom(room);
  });

  socket.on("host:transfer", ({ code, userId } = {}) => {
    const room = getRoom(code);
    if (!room || room.hostId !== socket.id || !room.users.has(userId)) return;
    room.hostId = userId;
    room.hostName = room.users.get(userId).name;
    io.to(room.code).emit("chat:system", `${room.hostName} is now the host`);
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      if (!room.users.has(socket.id)) continue;
      const name = room.users.get(socket.id).name;
      room.users.delete(socket.id);
      if (room.hostId === socket.id) {
        const next = room.users.values().next().value;
        if (next) { room.hostId = next.id; room.hostName = next.name; }
      }
      if (room.users.size === 0) rooms.delete(room.code);
      else {
        io.to(room.code).emit("chat:system", `${name} left the room`);
        emitRoom(room);
      }
    }
  });
});

server.listen(PORT, () => console.log(`Watch Party running at http://localhost:${PORT}`));
